import { check } from 'express-validator';
import {
  ASSIGNABLE_ORGANIZATION_ROLES,
  SINGLE_OWNER_NOTE,
} from '../../types/config/permissions';
import { checkFileIsImage, checkFileMaxSize } from './FileValidationHelper';
import { isHexColor, isSelectableAvatarPath } from '../../config/defaultAvatars';

const maxFileSize = 2000000; // around 2Mb

const create = [
  check('name')
    .exists()
    .withMessage('A name must be provided')
    .isString()
    .withMessage('The name field must be a string')
    .isLength({ min: 3, max: 50 })
    .withMessage('The name must be between 3 and 50 characters')
    .matches(/^[a-z0-9_-]+$/)
    .withMessage('The name may only contain lowercase letters, numbers, hyphens and underscores')
    .trim(),
  check('displayName')
    .exists()
    .withMessage('A displayName must be provided')
    .isString()
    .withMessage('The displayName field must be a string')
    .isLength({ max: 255 })
    .withMessage('The displayName must not exceed 255 characters')
    .trim(),
  check('description')
    .optional()
    .isString()
    .withMessage('The description field must be a string')
    .trim(),
  check('isPersonal').optional().isBoolean().withMessage('The isPersonal field must be a boolean'),
  check('_parentId')
    .optional()
    .isString()
    .withMessage('The _parentId field must be a string')
    .matches(/^[a-f0-9]{24}$/)
    .withMessage('The _parentId must be a valid MongoDB ObjectId'),
];

const update = [
  check('displayName')
    .optional()
    .isString()
    .withMessage('The displayName field must be a string')
    .isLength({ max: 255 })
    .withMessage('The displayName must not exceed 255 characters')
    .trim(),
  check('description')
    .optional({ values: 'null' })
    .isString()
    .withMessage('The description field must be a string')
    .trim(),
  check('avatar')
    .optional()
    .custom((value, { req }) => {
      return checkFileIsImage(req, 'avatar');
    })
    .withMessage('Please upload an image with format (jpeg, png).'),
  check('avatar')
    .custom((value, { req }) => {
      return checkFileMaxSize(req, 'avatar', maxFileSize);
    })
    .withMessage('Maximum file size of ' + maxFileSize / 1000000 + 'MB'),
];

const updateAvatarColors = [
  // An empty path means "use the initials", so the field is checked against the
  // predefined list rather than merely being required to be a string: without
  // that, a caller could point the image anywhere they liked.
  check('avatarPath')
    .optional({ values: 'null' })
    .custom(isSelectableAvatarPath)
    .withMessage('The avatarPath must be empty or one of the predefined avatars'),
  check('avatarBgColor')
    .optional({ values: 'null' })
    .custom(isHexColor)
    .withMessage('The avatarBgColor must be a hex colour, for example #023e8a'),
  check('avatarFgColor')
    .optional({ values: 'null' })
    .custom(isHexColor)
    .withMessage('The avatarFgColor must be a hex colour, for example #ffffff'),
];

const addMember = [
  check('userId')
    .exists()
    .withMessage('A userId must be provided')
    .isString()
    .withMessage('The userId field must be a string'),
  check('role')
    .exists()
    .withMessage('A role must be provided')
    .isIn(ASSIGNABLE_ORGANIZATION_ROLES)
    .withMessage(`The role must be one of: ADMIN, MEMBER. ${SINGLE_OWNER_NOTE}`),
];

const addMembersBulk = [
  check('members')
    .exists()
    .withMessage('A members array must be provided')
    .isArray({ min: 1, max: 100 })
    .withMessage('The members field must contain between 1 and 100 members')
    .custom((members: Array<{ userId?: string }>) => {
      const userIds = members.map(member => member?.userId);
      return new Set(userIds).size === userIds.length;
    })
    .withMessage('The members field cannot contain duplicate userIds'),
  check('members.*')
    .custom((member) => {
      if (!member || typeof member !== 'object' || Array.isArray(member)) return false;
      const allowedFields = new Set(['userId', 'role']);
      return Object.keys(member).every(field => allowedFields.has(field));
    })
    .withMessage('Every member may only contain userId and role'),
  check('members.*.userId')
    .exists()
    .withMessage('A userId must be provided for every member')
    .isMongoId()
    .withMessage('Every userId must be a valid MongoDB ObjectId'),
  check('members.*.role')
    .exists()
    .withMessage('A role must be provided for every member')
    .isIn(ASSIGNABLE_ORGANIZATION_ROLES)
    .withMessage(`Every role must be one of: ADMIN, MEMBER. ${SINGLE_OWNER_NOTE}`),
];


const createChildrenBulk = [
  check('organizations')
    .exists()
    .withMessage('An organizations array must be provided')
    .isArray({ min: 1, max: 100 })
    .withMessage('The organizations field must contain between 1 and 100 organizations'),
  check('organizations.*')
    .custom((organization) => {
      if (!organization || typeof organization !== 'object' || Array.isArray(organization)) {
        return false;
      }
      const allowedFields = new Set(['name', 'displayName', 'description']);
      return Object.keys(organization).every(field => allowedFields.has(field));
    })
    .withMessage('Child organizations may only contain name, displayName and description'),
  check('organizations.*.name')
    .exists()
    .withMessage('A name must be provided for every organization')
    .isString()
    .withMessage('Every organization name must be a string')
    .isLength({ min: 3, max: 50 })
    .withMessage('Every organization name must be between 3 and 50 characters')
    .matches(/^[a-z0-9_-]+$/)
    .withMessage('Organization names may only contain lowercase letters, numbers, hyphens and underscores')
    .trim(),
  check('organizations.*.displayName')
    .exists()
    .withMessage('A displayName must be provided for every organization')
    .isString()
    .withMessage('Every organization displayName must be a string')
    .isLength({ min: 1, max: 255 })
    .withMessage('Every organization displayName must be between 1 and 255 characters')
    .trim(),
  check('organizations.*.description')
    .optional()
    .isString()
    .withMessage('Every organization description must be a string')
    .trim(),
];

const updateMemberRole = [
  check('role')
    .exists()
    .withMessage('A role must be provided')
    .isIn(ASSIGNABLE_ORGANIZATION_ROLES)
    .withMessage(`The role must be one of: ADMIN, MEMBER. ${SINGLE_OWNER_NOTE}`),
];

const moveToParent = [
  // `exists()` keeps its default of only treating `undefined` as missing, so an
  // explicit null goes through: that is how an organization is moved to the root.
  check('parentId')
    .exists()
    .withMessage('A parentId must be provided, using null to move the organization to the root')
    .custom((value: unknown) => value === null || /^[a-f0-9]{24}$/.test(String(value)))
    .withMessage('The parentId must be null or a valid MongoDB ObjectId'),
];

const transferOwnership = [
  check('userId')
    .exists()
    .withMessage('The userId of the member receiving the organization is required')
    .custom((value: unknown) => /^[a-f0-9]{24}$/.test(String(value)))
    .withMessage('The userId must be a valid MongoDB ObjectId'),
];

export {
  create,
  update,
  updateAvatarColors,
  addMember,
  addMembersBulk,
  createChildrenBulk,
  moveToParent,
  transferOwnership,
  updateMemberRole,
};
