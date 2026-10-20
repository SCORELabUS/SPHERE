import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  notificationRepository: { create: vi.fn() },
  userRepository: { findById: vi.fn() },
  emailService: { sendNotificationEmail: vi.fn() },
  sse: { sendToUser: vi.fn() },
}));

vi.mock('../../main/config/container', () => ({
  default: {
    resolve: vi.fn((name: string) => {
      if (name === 'notificationRepository') return mocks.notificationRepository;
      if (name === 'userRepository') return mocks.userRepository;
      if (name === 'emailService') return mocks.emailService;
      return undefined;
    }),
  },
}));
vi.mock('../../main/services/SseManager', () => ({ default: mocks.sse }));

import NotificationService from '../../main/services/NotificationService';

const buildUser = (prefs?: unknown) => ({
  id: 'user-1',
  email: 'person@example.com',
  firstName: 'Test',
  settings: prefs === undefined ? {} : { notificationPrefs: prefs },
});

const payload = {
  userId: 'user-1',
  kind: 'OrganizationInvitation',
  title: 'You have been invited',
  message: 'Someone invited you',
};

describe('NotificationService.createNotification', () => {
  let service: NotificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notificationRepository.create.mockResolvedValue({ id: 'n-1', ...payload, read: false });
    mocks.emailService.sendNotificationEmail.mockResolvedValue(undefined);
    service = new NotificationService();
  });

  it('delivers in-app and by email when both channels are on', async () => {
    mocks.userRepository.findById.mockResolvedValue(
      buildUser({ OrganizationInvitation: { email: true, inbox: true } })
    );

    const notification = await service.createNotification(payload);

    expect(notification).not.toBeNull();
    expect(mocks.notificationRepository.create).toHaveBeenCalledTimes(1);
    expect(mocks.sse.sendToUser).toHaveBeenCalledTimes(1);
    expect(mocks.emailService.sendNotificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientEmail: 'person@example.com',
        recipientName: 'Test',
        title: payload.title,
        message: payload.message,
        actionUrl: expect.stringMatching(/\/notifications$/),
      })
    );
  });

  it('skips the in-app notification but still emails when only email is on', async () => {
    mocks.userRepository.findById.mockResolvedValue(
      buildUser({ OrganizationInvitation: { email: true, inbox: false } })
    );

    const notification = await service.createNotification(payload);

    expect(notification).toBeNull();
    expect(mocks.notificationRepository.create).not.toHaveBeenCalled();
    expect(mocks.sse.sendToUser).not.toHaveBeenCalled();
    expect(mocks.emailService.sendNotificationEmail).toHaveBeenCalledTimes(1);
  });

  it('stores the notification but sends no email when only the in-app channel is on', async () => {
    mocks.userRepository.findById.mockResolvedValue(
      buildUser({ OrganizationInvitation: { email: false, inbox: true } })
    );

    await service.createNotification(payload);

    expect(mocks.notificationRepository.create).toHaveBeenCalledTimes(1);
    expect(mocks.emailService.sendNotificationEmail).not.toHaveBeenCalled();
  });

  it('delivers nothing when both channels are off', async () => {
    mocks.userRepository.findById.mockResolvedValue(
      buildUser({ OrganizationInvitation: { email: false, inbox: false } })
    );

    await expect(service.createNotification(payload)).resolves.toBeNull();

    expect(mocks.notificationRepository.create).not.toHaveBeenCalled();
    expect(mocks.emailService.sendNotificationEmail).not.toHaveBeenCalled();
  });

  it('only applies the preference of the notification kind', async () => {
    mocks.userRepository.findById.mockResolvedValue(
      buildUser({ System: { email: false, inbox: false } })
    );

    await service.createNotification(payload);

    expect(mocks.notificationRepository.create).toHaveBeenCalledTimes(1);
    expect(mocks.emailService.sendNotificationEmail).toHaveBeenCalledTimes(1);
  });

  it('reads preferences stored as a Map and treats missing ones as enabled', async () => {
    mocks.userRepository.findById.mockResolvedValue(
      buildUser(new Map([['OrganizationInvitation', { email: false, inbox: true }]]))
    );
    await service.createNotification(payload);
    expect(mocks.emailService.sendNotificationEmail).not.toHaveBeenCalled();

    mocks.userRepository.findById.mockResolvedValue(buildUser());
    await service.createNotification(payload);
    expect(mocks.emailService.sendNotificationEmail).toHaveBeenCalledTimes(1);
    expect(mocks.notificationRepository.create).toHaveBeenCalledTimes(2);
  });

  it('still stores the notification when the email provider fails', async () => {
    mocks.userRepository.findById.mockResolvedValue(buildUser());
    mocks.emailService.sendNotificationEmail.mockRejectedValue(new Error('provider down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(service.createNotification(payload)).resolves.not.toBeNull();
    await new Promise(resolve => setImmediate(resolve));

    expect(mocks.notificationRepository.create).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('does nothing when the recipient does not exist', async () => {
    mocks.userRepository.findById.mockResolvedValue(null);

    await expect(service.createNotification(payload)).resolves.toBeNull();

    expect(mocks.notificationRepository.create).not.toHaveBeenCalled();
    expect(mocks.emailService.sendNotificationEmail).not.toHaveBeenCalled();
  });
});
