import { body, check, param, query } from 'express-validator';
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

const isText = body('source.kind').equals('text');
const isFork = body('source.kind').equals('fork');

/** Where a proposal comes from: a text written on a version of P, or a fork's latest version. */
const source = [
  check('source').isObject().withMessage('The source of the proposal is required'),
  check('source.kind').isIn(['text', 'fork']).withMessage('The source kind must be text or fork'),
  check('source.pricingId').if(isText).isMongoId().withMessage('The source pricingId must be a pricing id'),
  check('source.baseVersionId').if(isText).isMongoId().withMessage('The source baseVersionId must be a version id'),
  check('source.proposedYaml').if(isText).isString().withMessage('The proposed YAML must be a text'),
  check('source.forkPricingId').if(isFork).isMongoId().withMessage('The source forkPricingId must be a pricing id'),
];

/** The side chosen for each conflict, by conflict id (which conflicts and sides exist is checked by the merge). */
const resolutions = (chain = check('resolutions')) =>
  chain
    .optional()
    .custom(value => typeof value === 'object' && value !== null && !Array.isArray(value))
    .withMessage('The resolutions must map conflict ids to current or proposal');

const manualYaml = (chain = check('manualYaml')) => chain.optional().isString().withMessage('The manual YAML must be a text');
const previewToken = (chain = check('previewToken')) => chain.isString().withMessage('The preview token is required');

const create = [
  title(true),
  description,
  ...source,
  resolutions(check('resolutions').if(isFork)),
  manualYaml(check('manualYaml').if(isFork)),
  previewToken(check('previewToken').if(isFork)),
];

const forkTarget = [query('forkPricingId').isMongoId().withMessage('The forkPricingId query parameter must be a pricing id')];

const preview = [...source, resolutions()];

const show = [pullRequestId];

const update = [
  pullRequestId,
  title(false),
  description,
  check('proposedYaml').optional().isString().withMessage('The proposed YAML must be a text'),
];

const mergePreview = [
  pullRequestId,
  check('purpose').isIn(['update', 'merge']).withMessage('The purpose must be update or merge'),
  resolutions(),
];

const updateToLatest = [pullRequestId, resolutions(), manualYaml(), previewToken()];

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

/** The label of the version a merge publishes: 1-100 characters, without control characters. */
const merge = [
  pullRequestId,
  check('version')
    .isString()
    .withMessage('The version must be a text')
    .bail()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('The version must have between 1 and 100 characters')
    .matches(NO_CONTROL_CHARACTERS)
    .withMessage('The version cannot contain control characters'),
  check('private').isBoolean({ strict: true }).withMessage('private must be true or false').toBoolean(true),
  resolutions(),
  manualYaml(),
  previewToken(),
];

export { list, create, forkTarget, preview, show, update, mergePreview, updateToLatest, close, merge };
