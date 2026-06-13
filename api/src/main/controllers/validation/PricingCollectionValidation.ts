import { check } from 'express-validator';

const create = [
  check('name')
    .exists({ checkNull: true, checkFalsy: true })
    .withMessage('The name field is required')
    .isString()
    .withMessage('The name field must be a string')
    .isLength({ min: 1, max: 255 })
    .withMessage('The name must have between 1 and 255 characters long')
    .trim(),
  check('description')
    .optional()
    .isString()
    .withMessage('The description field must be a string')
    .trim(),
  check('private')
    .optional()
    .isBoolean()
    .withMessage('The private field must be boolean'),
  check('pricings')
    .optional()
    .isArray()
    .withMessage('The pricings field must be an array')
    .custom((pricings) => {
      for (const pricing of pricings) {
        if (typeof pricing !== 'string') {
          throw new Error('Each pricing must be a string');
        }
      }

      return true;
    })
];

const update = [
  check('name')
    .optional()
    .isString()
    .withMessage('The name field must be a string')
    .isLength({ min: 1, max: 255 })
    .withMessage('The name must have between 1 and 255 characters long')
    .trim(),
  check('description')
    .optional()
    .isString()
    .withMessage('The name field must be a string')
    .trim(),
  check('private')
    .optional()
    .isBoolean()
    .withMessage('The private field must be boolean'),
  check('analytics')
    .optional()
    .isObject()
    .withMessage('analytics must be an object'),
  check('analytics.evolutionOfPlans')
    .optional()
    .isObject()
    .withMessage('evolutionOfPlans must be an object'),
  check('analytics.evolutionOfAddOns')
    .optional()
    .isObject()
    .withMessage('evolutionOfAddOns must be an object'),
  check('analytics.evolutionOfFeatures')
    .optional()
    .isObject()
    .withMessage('evolutionOfFeatures must be an object'),
  check('analytics.evolutionOfConfigurationSpaceSize')
    .optional()
    .isObject()
    .withMessage('evolutionOfConfigurationSpaceSize must be an object'),
];

export { create, update };