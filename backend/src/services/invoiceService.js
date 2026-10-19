"use strict";

const PDFDocument = require("pdfkit");
const { getCurrentXlmPrice } = require("./xlmPriceService");

const DEFAULT_COMPANY_NAME = "Stellar MarketPay";

class InvoiceGENERATIONError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "InvoiceGENERATIONError";
    this.code = "INVOICE_GENERATION_FAILED";
    if (options.cause) {
      this.cause = options.cause;
    }
  }
}

function toFiniteNumber(value) {
  const num = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(num) ? num : NaN;
}

// Round to cents using half-up away from zero to avoid binary float drift.
function roundToCents(value) {
  if (!Number.isFinite(value)) return NaN;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  // Epsilon adjustment handles classic floating point representation issues (e.g. 1.005).
  const cents = Math.round((abs + Number.EPSILON) * 100) / 100;
  return sign * cents;
}

function formatCurrencyAmount(amount, currency, locale = "en-US") {
  const numeric = toFiniteNumber(amount);
  if (!Number.isFinite(numeric)) {
    return "N/A";
  }

  if (currency === "XLM") {
    // XLM is not an ISO 4217 currency code for Intl.NumberFormat, so format the number
    // and append the code manually to keep locale sensitive grouping/decimal separators.
    const formatted = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 7,
    }).format(numeric);
    return `${formatted} XLM`;
  }

  if (currency === "USDC") {
    // USDC is a stablecoin; format to cents and label with the code.
    const rounded = roundToCents(numeric);
    const formatted = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(rounded);
    return `${formatted} USD`;
  }

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(numeric);
  } catch (_e) {
    return `${roundToCents(numeric).toFixed(2)} ${currency}`;
  }
}

function computeInvoiceTotals({
  budget,
  currency = "XLM",
  feeRate = 0,
  taxRate = 0,
  lineItems = [],
}) {
  const budgetNumeric = toFiniteNumber(budget);
  if (!Number.isFinite(budgetNumeric)) {
    throw new InvoiceGENERATIONError(`Invalid invoice budget: ${budget}`);
  }

  const normalizedLineItems = Array.isArray(lineItems)
    ? lineItems.map((item, index) => {
        const amount = toFiniteNumber(item.amount);
        if (!Number.isFinite(amount)) {
          throw new InvoiceGENERATIONError(`Invalid line item amount at index ${index}`);
        }
        return {
          description: item.description || `Item ${index + 1}`,
          amount,
        };
      })
    : [];

  const lineItemsTotal = normalizedLineItems.reduce((sum, item) => sum + item.amount, 0);
  const subtotal = roundToCents(lineItems.length > 0 ? lineItemsTotal : budgetNumeric);
  const normalizedFeeRate = Number.isFinite(Number(feeRate)) ? Number(feeRate) : 0;
  const normalizedTaxRate = Number.isFinite(Number(taxRate)) ? Number(taxRate) : 0;
  const fee = roundToCents(subtotal * normalizedFeeRate);
  const tax = roundToCents(subtotal * normalizedTaxRate);
  const total = roundToCents(subtotal + fee + tax);

  return {
    currency,
    lineItems: normalizedLineItems,
    subtotal,
    fee,
    tax,
    total,
  };
}

async function resolveXlmPrice() {
  try {
    const priceData = await getCurrentXlmPrice();
    const price = toFiniteNumber(priceData && priceData.priceUsd);
    return Number.isFinite(price) ? price : 0;
  } catch (e) {
    console.error("Failed to fetch XLM price", e);
    return 0;
  }
}

async function generateInvoicePdf(job, writeStream, options = {}) {
  if (!job || typeof job !== "object") {
    throw new InvoiceGENERATIONError("Invoice generation requires a job object");
  }
  if (!writeStream || typeof writeStream.write !== "function") {
    throw new InvoiceGENERATIONError("Invoice generation requires a writable stream");
  }

  const locale = options.locale || "en-US";
  const currency = options.currency || job.currency || "XLM";
  const feeRate = options.feeRate !== undefined ? options.feeRate : job.feeRate || 0;
  const taxRate = options.taxRate !== undefined ? options.taxRate : job.taxRate || 0;
  const lineItems = options.lineItems || job.lineItems || [];

  const totals = computeInvoiceTotals({
    budget: job.budget,
    currency,
    feeRate,
    taxRate,
    lineItems,
  });

  const xlmPrice = currency === "XLM" ? await resolveXlmPrice() : 0;
  const companyName = process.env.INVOICE_COMPANY_NAME || DEFAULT_COMPANY_NAME;

  return new Promise((resolve, reject) => {
    let doc;
    try {
      doc = new PDFDocument({ margin: 50 });
    } catch (e) {
      reject(new InvoiceGENERATIONError("Failed to initialize PDF document", { cause: e }));
      return;
    }

    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(
        err instanceof InvoiceGENERATIONError
          ? err
          : new InvoiceGENERATIONError(`Failed to generate invoice PDF: ${err && err.message ? err.message : "unknown error"}`, { cause: err })
      );
    };

    try {
      doc.on("error", fail);
      if (typeof writeStream.on === "function") {
        writeStream.on("error", fail);
      }
      doc.pipe(writeStream);

      doc.fontSize(20).text("INVOICE", { align: "right" });
      doc.fontSize(10).text(companyName, { align: "right" });
      doc.moveDown(2);

      doc.fontSize(14).text("Job Details", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Job ID: ${job.id}`);
      doc.text(`Title: ${job.title}`);

      const completionDate =
        job.status === "completed" && job.updatedAt
          ? new Date(job.updatedAt).toLocaleDateString(locale)
          : new Date().toLocaleDateString(locale);
      doc.text(`Completion Date: ${completionDate}`);
      doc.moveDown(1.5);

      doc.fontSize(14).text("Parties", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Client Address: ${job.clientAddress}`);
      doc.text(`Freelancer Address: ${job.freelancerAddress || "N/A"}`);
      doc.moveDown(1.5);

      doc.fontSize(14).text("Line Items", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10);
      if (totals.lineItems.length === 0) {
        doc.text(`${formattedCurrencyAmount(totals.subtotal, currency, locale)} (job budget)`);
      } else {
        for (const item of totals.lineItems) {
          doc.text(`${item.description}: ${formattedCurrencyAmount(item.amount, currency, locale)}`);
        }
      }
      doc.moveDown(1);

      doc.fontSize(14).text("Amount", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10);
      doc.text(`Subtotal: ${formattedCurrencyAmount(totals.subtotal, currency, locale)}`);
      doc.text(`Fee: ${formattedCurrencyAmount(totals.fee, currency, locale)}`);
      doc.text(`Tax: ${formattedCurrencyAmount(totals.tax, currency, locale)}`);
      doc.text(`Total: ${formattedCurrencyAmount(totals.total, currency, locale)}`);

      if (currency === "XLM") {
        if (xlmPrice > 0) {
          const totalUsd = roundToCents(totals.total * xlmPrice);
          doc.text(`USD Equivalent: ${formattedCurrencyAmount(totalUsd, "USD", locale)}`);
        } else {
          doc.text("USD Equivalent: N/A");
        }
      }
      doc.moveDown(1.5);

      doc.fontSize(14).text("Transaction Details", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Transaction Hash (Escrow): ${job.escrowContractId || "N/A"}`);

      doc.end();
    } catch (e) {
      fail(e);
      return;
    }

    // Resolve once the output stream finishes writing the PDF bytes.
    if (typeof writeStream.on === "function") {
      writeStream.once("finish", () => {
        if (settled) return;
        settled = true;
        resolve();
      });
      writeStream.once("close", () => {
        if (settled) return;
        settled = true;
        resolve();
      });
    } else {
      // For streams without events (e.g. custom sink), resolve on next tick.
      setImmediate(() => {
        if (settled) return;
        settled = true;
        resolve();
      });
    }
  });
}

module.exports = {
  generateInvoicePdf,
  computeInvoiceTotals,
  formatCurrencyAmount,
  roundToCents,
  InvoiceGENERATIONError,
};
