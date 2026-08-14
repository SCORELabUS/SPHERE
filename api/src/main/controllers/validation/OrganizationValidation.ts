import { check } from 'express-validator';
import { checkFileIsImage, checkFileMaxSize } from './FileValidationHelper';

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

const addMember = [
  check('userId')
    .exists()
    .withMessage('A userId must be provided')
    .isString()
    .withMessage('The userId field must be a string'),
  check('role')
    .exists()
    .withMessage('A role must be provided')
    .isIn(['OWNER', 'ADMIN', 'MEMBER'])
    .withMessage('The role must be one of: OWNER, ADMIN, MEMBER'),
];

const updateMemberRole = [
  check('role')
    .exists()
    .withMessage('A role must be provided')
    .isIn(['OWNER', 'ADMIN', 'MEMBER'])
    .withMessage('The role must be one of: OWNER, ADMIN, MEMBER'),
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

export { create, update, addMember, updateMemberRole, createChildrenBulk };
