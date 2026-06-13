import container from '../config/container';
import UserRepository from '../repositories/mongoose/UserRepository';
import { processFileUris } from './FileService';

class UserSettingsService {
  private userRepository: UserRepository;

  constructor() {
    this.userRepository = container.resolve('userRepository');
  }

  private sanitize(user: any) {
    const { password, token, tokenExpiration, apiKeys, ...rest } = user;
    if (rest.settings?.avatar) {
      processFileUris(rest.settings, ['avatar']);
    }
    return rest;
  }

  async getSettings(userId: string) {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new Error('NOT FOUND: User not found');
    return this.sanitize(user);
  }

  async updateAccount(userId: string, data: { email?: string; firstName?: string; lastName?: string; phone?: string }) {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new Error('NOT FOUND: User not found');

    if (data.email && data.email !== user.email) {
      const existing = await this.userRepository.findByEmail(data.email);
      if (existing) throw new Error('INVALID DATA: Email already in use');
    }

    const updateData: any = {};
    if (data.email !== undefined) updateData.email = data.email;
    if (data.firstName !== undefined) updateData.firstName = data.firstName;
    if (data.lastName !== undefined) updateData.lastName = data.lastName;
    if (data.phone !== undefined) {
      updateData['settings.phone'] = data.phone;
    }

    const updated = await this.userRepository.updateById(userId, updateData);
    if (!updated) throw new Error('NOT FOUND: User not found after update');
    return this.sanitize(updated);
  }

  async updateProfile(userId: string, data: { displayName?: string; bio?: string; city?: string; country?: string; dateOfBirth?: string }) {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new Error('NOT FOUND: User not found');

    const updateData: Record<string, any> = {};
    if (data.displayName !== undefined) updateData['settings.profile.displayName'] = data.displayName;
    if (data.bio !== undefined) updateData['settings.profile.bio'] = data.bio;
    if (data.city !== undefined) updateData['settings.profile.city'] = data.city;
    if (data.country !== undefined) updateData['settings.profile.country'] = data.country;
    if (data.dateOfBirth !== undefined) updateData['settings.profile.dateOfBirth'] = data.dateOfBirth;

    const updated = await this.userRepository.updateById(userId, updateData);
    if (!updated) throw new Error('NOT FOUND: User not found after update');
    return this.sanitize(updated);
  }

  async updateSocialLinks(userId: string, data: { linkedin?: string; instagram?: string; facebook?: string; x?: string }) {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new Error('NOT FOUND: User not found');

    const SOCIAL_URL_PATTERNS: Record<string, RegExp[]> = {
      linkedin: [
        /^https?:\/\/(www\.)?linkedin\.com\/in\/[\w\-%.]+\/?$/,
        /^https?:\/\/(www\.)?linkedin\.com\/company\/[\w\-%.]+\/?$/,
      ],
      instagram: [/^https?:\/\/(www\.)?instagram\.com\/[\w%.]+\/?$/],
      facebook: [
        /^https?:\/\/(www\.)?facebook\.com\/[\w%.]+\/?$/,
        /^https?:\/\/(www\.)?facebook\.com\/pages\/[\w\-%.]+\/\d+\/?$/,
      ],
      x: [
        /^https?:\/\/(www\.)?x\.com\/[\w]+\/?$/,
        /^https?:\/\/(www\.)?twitter\.com\/[\w]+\/?$/,
      ],
    };

    for (const [platform, url] of Object.entries(data)) {
      if (url && SOCIAL_URL_PATTERNS[platform]) {
        const isValid = SOCIAL_URL_PATTERNS[platform].some((p) => p.test(url));
        if (!isValid) throw new Error(`INVALID DATA: Invalid URL for ${platform}`);
      }
    }

    const updateData: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      updateData[`settings.socialLinks.${key}`] = value;
    }

    const updated = await this.userRepository.updateById(userId, updateData);
    if (!updated) throw new Error('NOT FOUND: User not found after update');
    return this.sanitize(updated);
  }

  async updateNotificationPrefs(userId: string, prefs: Record<string, { email: boolean; inbox: boolean }>) {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new Error('NOT FOUND: User not found');

    const updateData: Record<string, any> = {};
    for (const [kind, channels] of Object.entries(prefs)) {
      updateData[`settings.notificationPrefs.${kind}`] = channels;
    }

    const updated = await this.userRepository.updateById(userId, updateData);
    if (!updated) throw new Error('NOT FOUND: User not found after update');
    return this.sanitize(updated);
  }

  async updateAvatar(userId: string, data: { avatarPath: string; avatarBgColor: string; avatarFgColor: string }) {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new Error('NOT FOUND: User not found');

    const updated = await this.userRepository.updateById(userId, {
      'settings.avatar': data.avatarPath,
      'settings.avatarBgColor': data.avatarBgColor,
      'settings.avatarFgColor': data.avatarFgColor,
    });
    if (!updated) throw new Error('NOT FOUND: User not found after update');
    return this.sanitize(updated);
  }

  async removeAvatar(userId: string) {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new Error('NOT FOUND: User not found');

    const updated = await this.userRepository.updateById(userId, {
      'settings.avatar': null,
      'settings.avatarBgColor': null,
      'settings.avatarFgColor': null,
    });
    if (!updated) throw new Error('NOT FOUND: User not found after update');
    return this.sanitize(updated);
  }
}

export default UserSettingsService;
