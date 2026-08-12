import mongoose, { Document, Schema } from 'mongoose';
import { USER_ROLES, UserRole } from '../../../types/config/permissions';
import { processFileUris } from '../../../services/FileService';
import { generateUserTokenDTO, hashPassword } from '../../../utils/users/helpers';

const ApiKeySchema = new Schema(
  {
    key: { type: String, required: true },
    name: { type: String, required: true },
    scopes: [
      {
        organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
        scope: {
          type: String,
          enum: ['ALL', 'MANAGEMENT', 'VIEW'],
          required: true,
        },
      },
    ],
    expiresAt: { type: Date, default: null },
    revoked: { type: Boolean, default: false },
  },
  { _id: true }
);

const IdentitySchema = new Schema(
  {
    provider: { type: String, enum: ['us-sso', 'google'], required: true },
    providerId: { type: String, required: true },
    email: { type: String, lowercase: true, trim: true },
    emailVerified: { type: Boolean, required: true, default: false },
    linkedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const UserSettingsSchema = new Schema(
  {
    phone: { type: String },
    avatar: { type: String },
    avatarBgColor: { type: String },
    avatarFgColor: { type: String },
    profile: {
      displayName: { type: String },
      bio: { type: String },
      city: { type: String },
      country: { type: String },
      dateOfBirth: { type: String },
    },
    socialLinks: {
      linkedin: { type: String },
      instagram: { type: String },
      facebook: { type: String },
      x: { type: String },
    },
    notificationPrefs: {
      type: Map,
      of: new Schema(
        {
          email: { type: Boolean, default: true },
          inbox: { type: Boolean, default: true },
        },
        { _id: false }
      ),
      default: () => ({
        OrganizationInvitation: { email: true, inbox: true },
        System: { email: true, inbox: true },
        CollectionShared: { email: true, inbox: true },
        PricingUpdated: { email: true, inbox: true },
      }),
    },
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      minlength: 5,
      // Solo obligatoria para cuentas locales puras: las cuentas con identidad
      // externa (SSO UVUS, Google) no tienen contraseña.
      required: function (this: any) {
        return !this.identities || this.identities.length === 0;
      },
      select: false,
    },
    identities: {
      type: [IdentitySchema],
      default: [],
    },
    role: {
      type: String,
      required: true,
      enum: USER_ROLES,
      default: USER_ROLES[USER_ROLES.length - 1],
    },
    firstName: {
      type: String,
      required: true,
    },
    lastName: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please fill a valid email address'],
    },
    settings: {
      type: UserSettingsSchema,
      default: () => ({}),
    },
    token: {
      type: String,
    },
    tokenExpiration: {
      type: Date,
    },
    apiKeys: {
      type: [ApiKeySchema],
      select: false,
      default: [],
    },
  },
  {
    timestamps: true,
    toObject: {
      getters: true,
      virtuals: true,
      versionKey: false,
      transform: function (_, resultObject) {
        delete (resultObject as any)._id;

        const settings = (resultObject as any).settings;
        if (settings?.avatar) {
          processFileUris(settings, ['avatar']);
        }

        return resultObject;
      },
    },
  }
);

userSchema.pre('save', async function (callback) {
  const user = this;
  // SSO accounts have no password: nothing to hash.
  if (!user.isModified('password') || !user.password) return callback();

  user.password = await hashPassword(user.password);

  if (!user.token) {
    const tokenDTO = generateUserTokenDTO();
    user.token = tokenDTO.token;
    user.tokenExpiration = tokenDTO.tokenExpiration;
  }

  if (!user.settings) {
    user.settings = {} as any;
  }
  if (!user.settings.avatar) {
    user.settings.avatar = '';
  }

  callback();
});

export interface UserDocument extends Document {
  id: string;
  username: string;
  password: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  email: string;
  identities: {
    provider: 'us-sso' | 'google';
    providerId: string;
    email?: string;
    emailVerified: boolean;
    linkedAt?: Date;
  }[];
  settings?: {
    phone?: string;
    avatar?: string;
    avatarBgColor?: string;
    avatarFgColor?: string;
    profile?: {
      displayName?: string;
      bio?: string;
      city?: string;
      country?: string;
      dateOfBirth?: string;
    };
    socialLinks?: {
      linkedin?: string;
      instagram?: string;
      facebook?: string;
      x?: string;
    };
    notificationPrefs?: Record<string, { email: boolean; inbox: boolean }>;
  };
  token?: string;
  tokenExpiration?: Date;
  apiKeys: {
    _id: string;
    key: string;
    name: string;
    scopes: {
      organizationId: string;
      scope: 'ALL' | 'MANAGEMENT' | 'VIEW';
    }[];
    expiresAt?: Date;
    revoked: boolean;
  }[];
}

userSchema.index({ 'apiKeys.key': 1 });
userSchema.index(
  { 'identities.provider': 1, 'identities.providerId': 1 },
  { unique: true, sparse: true }
);

const userModel = mongoose.model<UserDocument>('User', userSchema, 'users');

export default userModel;
