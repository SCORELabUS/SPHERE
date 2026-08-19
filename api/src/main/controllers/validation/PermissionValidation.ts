import { body, check } from 'express-validator';

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

const setPermissionsBulk = [
  check('permissions')
    .optional()
    .isArray({ max: 100 })
    .withMessage('The permissions field must contain at most 100 items')
    .custom((items) => {
      if (!Array.isArray(items)) return true;

      const targets = new Set<string>();
      for (const item of items) {
        const target = `${item?.userId ?? ''}:${item?.entityType ?? ''}:${item?.entitySlug ?? ''}`;
        if (targets.has(target)) {
          throw new Error('The permissions array must not contain duplicate targets');
        }
        targets.add(target);
      }
      return true;
    }),
  check('permissions.*.userId')
    .exists()
    .withMessage('A userId must be provided for every permission')
    .isString()
    .withMessage('Every userId field must be a string')
    .matches(/^[a-f0-9]{24}$/)
    .withMessage('Every userId must be a valid MongoDB ObjectId'),
  check('permissions.*.entityType')
    .exists()
    .withMessage('An entityType must be provided for every permission')
    .isIn(['pricing', 'collection'])
    .withMessage('Every entityType must be one of: pricing, collection'),
  check('permissions.*.entitySlug')
    .optional({ values: 'null' })
    .isString()
    .withMessage('Every entitySlug field must be a string or null')
    .notEmpty()
    .withMessage('An entitySlug must not be an empty string'),
  check('permissions.*.permissions')
    .exists()
    .withMessage('A permissions object must be provided for every item')
    .isObject()
    .withMessage('Every permissions field must be an object'),
  check('permissions.*.permissions.GET')
    .optional()
    .isBoolean()
    .withMessage('Every permissions.GET value must be a boolean'),
  check('permissions.*.permissions.PUT')
    .optional()
    .isBoolean()
    .withMessage('Every permissions.PUT value must be a boolean'),
  check('permissions.*.permissions.DELETE')
    .optional()
    .isBoolean()
    .withMessage('Every permissions.DELETE value must be a boolean'),
  check('permissions.*.permissions.CREATE')
    .optional()
    .isBoolean()
    .withMessage('Every permissions.CREATE value must be a boolean'),
  check('removePermissionIds')
    .optional()
    .isArray({ max: 100 })
    .withMessage('The removePermissionIds field must contain at most 100 items')
    .custom(items => {
      if (!Array.isArray(items)) return true;
      if (new Set(items).size !== items.length) {
        throw new Error('The removePermissionIds array must not contain duplicates');
      }
      return true;
    }),
  check('removePermissionIds.*')
    .isString()
    .withMessage('Every permission ID to remove must be a string')
    .matches(/^[a-f0-9]{24}$/)
    .withMessage('Every permission ID to remove must be a valid MongoDB ObjectId'),
  body().custom((_value, { req }) => {
    const permissions = Array.isArray(req.body.permissions) ? req.body.permissions : [];
    const removePermissionIds = Array.isArray(req.body.removePermissionIds)
      ? req.body.removePermissionIds
      : [];
    const totalChanges = permissions.length + removePermissionIds.length;
    if (totalChanges < 1 || totalChanges > 100) {
      throw new Error('The bulk request must contain between 1 and 100 total changes');
    }
    return true;
  }),
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

export { setPermission, setPermissionsBulk, removePermission };
