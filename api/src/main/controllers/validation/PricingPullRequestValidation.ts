import { check, param, query } from 'express-validator';
import { PULL_REQUEST_STATUSES } from '../../types/models/PricingPullRequest';

const NO_CONTROL_CHARACTERS = /^[^\u0000-\u001F\u007F]*$/;

/** One line of text: 1-200 characters, without control characters. */
const title = (required: boolean) =>
  (required ? check('title') : check('title').optional())
    .isString()
    .withMessage('The title must be a text')
    .bail()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('The title must have between 1 and 200 characters')
    .matches(NO_CONTROL_CHARACTERS)
    .withMessage('The title cannot contain control characters');

/** Plain text, shown as written. */
const description = check('description')
  .optional()
  .isString()
  .withMessage('The description must be a text')
  .bail()
  .isLength({ max: 10000 })
  .withMessage('The description may have at most 10000 characters');

const pullRequestId = param('pullRequestId').isMongoId().withMessage('The pull request id is not valid');

const list = [
  query('pricingId').isMongoId().withMessage('The pricingId query parameter must be a pricing id'),
  query('status')
    .optional()
    .isIn(PULL_REQUEST_STATUSES)
    .withMessage(`The status must be one of ${PULL_REQUEST_STATUSES.join(', ')}`),
  query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('The page must be a positive number').toInt(),
];

const create = [
  title(true),
  description,
  check('source').isObject().withMessage('The source of the proposal is required'),
  check('source.kind').isIn(['text']).withMessage('The source kind must be text'),
  check('source.pricingId').isMongoId().withMessage('The source pricingId must be a pricing id'),
  check('source.baseVersionId').isMongoId().withMessage('The source baseVersionId must be a version id'),
  check('source.proposedYaml').isString().withMessage('The proposed YAML must be a text'),
];

const show = [pullRequestId];

const update = [
  pullRequestId,
  title(false),
  description,
  check('proposedYaml').optional().isString().withMessage('The proposed YAML must be a text'),
];

const close = [
  pullRequestId,
  check('reason')
    .optional()
    .isString()
    .withMessage('The reason must be a text')
    .bail()
    .isLength({ max: 500 })
    .withMessage('The reason may have at most 500 characters'),
];

export { list, create, show, update, close };
