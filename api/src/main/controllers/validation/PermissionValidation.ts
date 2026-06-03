import { check } from 'express-validator';

const setPermission = [
  check('userId')
    .exists()
    .withMessage('A userId must be provided')
    .isString()
    .withMessage('The userId field must be a string')
    .matches(/^[a-f0-9]{24}$/)
    .withMessage('The userId must be a valid MongoDB ObjectId'),
  check('entityType')
    .exists()
    .withMessage('An entityType must be provided')
    .isIn(['pricing', 'collection'])
    .withMessage('The entityType must be one of: pricing, collection'),
  check('entitySlug')
    .optional({ values: 'null' })
    .isString()
    .withMessage('The entitySlug field must be a string')
    .notEmpty()
    .withMessage('The entitySlug must not be an empty string'),
  check('permissions')
    .exists()
    .withMessage('A permissions object must be provided')
    .isObject()
    .withMessage('The permissions field must be an object'),
  check('permissions.GET')
    .optional()
    .isBoolean()
    .withMessage('permissions.GET must be a boolean'),
  check('permissions.PUT')
    .optional()
    .isBoolean()
    .withMessage('permissions.PUT must be a boolean'),
  check('permissions.DELETE')
    .optional()
    .isBoolean()
    .withMessage('permissions.DELETE must be a boolean'),
  check('permissions.CREATE')
    .optional()
    .isBoolean()
    .withMessage('permissions.CREATE must be a boolean'),
];

const removePermission = [
  check('permissionId')
    .exists()
    .withMessage('A permissionId must be provided')
    .isString()
    .withMessage('The permissionId field must be a string')
    .matches(/^[a-f0-9]{24}$/)
    .withMessage('The permissionId must be a valid MongoDB ObjectId'),
];

export { setPermission, removePermission };
