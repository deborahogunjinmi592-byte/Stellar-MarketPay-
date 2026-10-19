import type { Meta, StoryObj } from '@storybook/react';
import MessageThread from '../components/MessageThread';

const meta: Meta<typeof MessageThread> = {
  title: 'Components/MessageThread',
  component: MessageThread,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof MessageThread>;

const now = Date.now();

const baseMessages = [
  {
    id: 'msg-1',
    senderId: 'user-1',
    senderName: 'Alice',
    content: 'Hi! I just accepted your job offer.',
    createdAt: new Date(now - 1000 * 60 * 60 * 3).toISOString(),
  },
  {
    id: 'msg-2',
    senderId: 'user-2',
    senderName: 'Bob',
    content: 'Great! When can you start?',
    createdAt: new Date(now - 1000 * 60 * 60 * 2).toISOString(),
  },
  {
    id: 'msg-3',
    senderId: 'user-1',
    senderName: 'Alice',
    content: 'I can start tomorrow morning.',
    createdAt: new Date(now - 1000 * 60 * 60).toISOString(),
  },
];

const longMessages = Array.from({ length: 40 }, (_, i) => ({
  id: `msg-${i}`,
  senderId: i % 2 === 0 ? 'user-1' : 'user-2',
  senderName: i % 2 === 0 ? 'Alice' : 'Bob',
  content: i % 2 === 0
    ? `Message ${i + 1}: Thanks for the update, everything looks good on my end.`
    : `Message ${i + 1}: I will share the next steps shortly.`,
  createdAt: new Date(now - (i * 60 * 1000)).toISOString(),
}));

export const EmptyThread: Story = {
  args: {
    messages: [],
    currentUserId: 'user-1',
    peerName: 'Alice',
  },
};

export const DefaultThread: Story = {
  args: {
    messages: baseMessages,
    currentUserId: 'user-1',
    peerName: 'Alice',
  },
};

export const LongThread: Story = {
  args: {
    messages: longMessages,
    currentUserId: 'user-1',
    peerName: 'Alice',
  },
};

export const LoadingThread: Story = {
  args: {
    messages: [],
    currentUserId: 'user-1',
    peerName: 'Alice',
    isLoading: true,
  },
};

export const ErrorThread: Story = {
  args: {
    messages: [],
    currentUserId: 'user-1',
    peerName: 'Alice',
    error: 'Failed to load messages. Please try again.',
  },
};
