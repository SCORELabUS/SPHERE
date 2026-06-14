import RepositoryBase from '../RepositoryBase';
import PricingMongoose from './models/PricingMongoose';
import { PricingAnalytics } from '../../types/database/Pricing';
import { PricingIndexQueryParams } from '../../types/services/PricingService';
import mongoose, { PipelineStage } from 'mongoose';
import { LeanPricing } from '../../types/models/Pricing';
import { getPricingBySlugOrganizationAndVersionAggregator } from './aggregators/get-pricing-by-slug-organization-and-version';
import { OrgUserPermissionsContext } from '../../types/policies';
import { getPricingsAggregator } from './aggregators/pricings/get-pricings';
import { generateSlug } from '../../utils/slug-manager';
import { processFileUris } from '../../services/FileService';

class PricingRepository extends RepositoryBase {
  async findAll(queryParams: PricingIndexQueryParams, permissions: OrgUserPermissionsContext) {
    const { filteringPipeline, sortPipeline } = this._processPricingQueryParams(queryParams);

    try {
      // Build base pipeline and optionally add pagination stages that operate inside aggregation
      const basePipeline: PipelineStage[] = getPricingsAggregator(
        undefined,
        permissions,
        filteringPipeline,
        sortPipeline
      );

      const paginationPipeline = this._processPricingPagination(queryParams);

      const pricings: any = await PricingMongoose.aggregate([
        ...basePipeline,
        ...paginationPipeline,
      ]);
      const result = pricings[0] || {
        pricings: [],
        minPrice: [],
        maxPrice: [],
        configurationSpaceSize: [],
        total: 0,
      };
      result.pricings?.forEach((p: any) => {
        if (p.organization) processFileUris(p.organization, ['avatar']);
      });
      return result;
    } catch (err) {
      return { pricings: [] };
    }
  }

  async findByOrganizationId(
    organizationId: string,
    permissions: OrgUserPermissionsContext,
    queryParams: PricingIndexQueryParams
  ) {
    const { filteringPipeline, sortPipeline } = this._processPricingQueryParams(queryParams);

    const aggregator = getPricingsAggregator(
      organizationId,
      permissions,
      filteringPipeline,
      sortPipeline
    );

    const paginationPipeline = this._processPricingPagination(queryParams);

    const pricings = await PricingMongoose.aggregate([...aggregator, ...paginationPipeline]);
    const result = pricings[0] || {
      pricings: [],
      minPrice: [],
      maxPrice: [],
      configurationSpaceSize: [],
      total: 0,
    };
    result.pricings?.forEach((p: any) => {
      if (p.organization) processFileUris(p.organization, ['avatar']);
    });
    return result;
  }

  async findOne(
    slug: string,
    organizationId: string,
    queryParams: {
      collectionId?: string;
      collection?: string;
      version?: string;
      includePrivate?: boolean;
      organizationId?: string;
    } = { includePrivate: false }
  ) {
    // Filtro de visibilidad
    const visibilityMatch = queryParams.includePrivate
      ? {} // include all (public + private)
      : { private: false }; // only include public

    try {
      const organizationMatch = { _organizationId: new mongoose.Types.ObjectId(organizationId) };

      const pipeline = [
        {
          $match: {
            ...visibilityMatch,
            ...organizationMatch,
            ...(queryParams?.collectionId && {
              _collectionId: queryParams.collectionId,
            }),
          },
        },
        ...getPricingBySlugOrganizationAndVersionAggregator(
          slug,

          organizationId,

          queryParams.version
        ),
        ...(queryParams?.collection
          ? [
              {
                $match: {
                  'collection.slug': queryParams.collection,
                },
              },
            ]
          : []),
      ];

      const pricing = await PricingMongoose.aggregate(pipeline);

      if (!pricing || pricing.length === 0) {
        return null;
      }

      const result = pricing[0];
      if (result.versions) {
        result.versions.forEach((v: any) => {
          if (v.organization) processFileUris(v.organization, ['avatar']);
        });
      }
      return result;
    } catch (err) {
      return null;
    }
  }

  async findByCollection(collectionId: string) {
    try {
      const pricings = await PricingMongoose.find({ _collectionId: collectionId });

      return pricings;
    } catch (err) {
      return [];
    }
  }

  async findById(id: string): Promise<LeanPricing | null> {
    const pricing = await PricingMongoose.findOne({ _id: new mongoose.Types.ObjectId(id) });
    if (!pricing) {
      return null;
    }

    return pricing.toObject<LeanPricing>();
  }

  async findExistingSlug(slug: string, organizationId: string): Promise<boolean> {
    const existing = await PricingMongoose.findOne({
      slug,
      _organizationId: new mongoose.Types.ObjectId(organizationId),
    }).lean();
    return existing !== null;
  }

  async findBySlugAndOrganization(
    slug: string,
    organizationId: string
  ): Promise<LeanPricing | null> {
    const pricing = await PricingMongoose.findOne({
      slug,
      _organizationId: new mongoose.Types.ObjectId(organizationId),
    });
    if (!pricing) {
      return null;
    }
    return pricing.toObject<LeanPricing>();
  }

  async create(data: any[]) {
    data.forEach(item => {
      if (item._collectionId) {
        item._collectionId = String(item._collectionId);
      }

      if (item._organizationId) {
        item._organizationId = new mongoose.Types.ObjectId(item._organizationId);
      }

      if (!item.slug && item.name) {
        item.slug = generateSlug(item.name);
      }

      if (
        item.analytics &&
        item.analytics.minSubscriptionPrice &&
        Number.isNaN(item.analytics.minSubscriptionPrice)
      ) {
        item.analytics.minSubscriptionPrice = undefined;
      }
      if (
        item.analytics &&
        item.analytics.minSubscriptionPrice &&
        Number.isNaN(item.analytics.maxSubscriptionPrice)
      ) {
        item.analytics.maxSubscriptionPrice = undefined;
      }
    });

    return (await PricingMongoose.insertMany(data)).map(pricing => pricing.toObject());
  }

  async updateAnalytics(pricingId: string, analytics: PricingAnalytics) {
    const pricing = await PricingMongoose.findOne({ _id: pricingId });
    if (!pricing) {
      return null;
    }

    pricing.set({ analytics: analytics });
    await pricing.save();

    return pricing.toObject();
  }

  async updatePricingsCollectionName(pricingsToUpdate: any) {
    const bulkOps = pricingsToUpdate.map((pricing: any) => ({
      updateOne: {
        filter: { _id: pricing._id },
        update: { $set: { yaml: pricing.yaml } },
      },
    }));

    const result = await PricingMongoose.bulkWrite(bulkOps);

    return result.modifiedCount === pricingsToUpdate.length;
  }

  async addPricingToCollection(pricingSlug: string, organizationId: string, collectionId: string) {
    return await PricingMongoose.updateMany(
      {
        slug: pricingSlug,
        _organizationId: new mongoose.Types.ObjectId(organizationId),
      },
      {
        $set: { _collectionId: collectionId },
      }
    );
  }

  async addPricingsToCollection(collectionId: string, organizationId: string, pricings: string[]) {
    const result = await PricingMongoose.updateMany(
      { slug: { $in: pricings }, _organizationId: new mongoose.Types.ObjectId(organizationId) },
      { $set: { _collectionId: collectionId } }
    );

    return result.modifiedCount === pricings.length;
  }

  async update(id: string, data: any) {
    const pricing = await PricingMongoose.findOne({ _id: id });
    if (!pricing) {
      return null;
    }

    pricing.set(data);
    await pricing.save();

    return pricing.toObject();
  }

  async removePricingFromCollection(pricingSlug: string, organizationId: string) {
    return await PricingMongoose.updateMany(
      {
        slug: pricingSlug,
        _organizationId: new mongoose.Types.ObjectId(organizationId),
      },
      {
        $unset: { _collectionId: 1 },
      }
    );
  }

  async removePricingsFromCollection(collectionId: string) {
    return await PricingMongoose.updateMany(
      {
        _collectionId: collectionId,
      },
      {
        $unset: { _collectionId: 1 },
      }
    );
  }

  async destroyBySlugOrganizationAndCollectionId(
    slug: string,
    organizationId: string,
    collectionId?: string
  ) {
    if (collectionId) {
      const result = await PricingMongoose.deleteMany({
        slug: slug,
        _organizationId: new mongoose.Types.ObjectId(organizationId),
        _collectionId: collectionId,
      });
      return result.deletedCount >= 1;
    } else {
      const result = await PricingMongoose.deleteMany({
        slug: slug,
        _organizationId: new mongoose.Types.ObjectId(organizationId),
        _collectionId: { $exists: false },
      });
      return result.deletedCount >= 1;
    }
  }

  async destroyVersionBySlugAndOrganization(
    slug: string,
    version: string,
    organizationId: string,
    ...args: any
  ) {
    const result = await PricingMongoose.deleteOne({
      slug: slug,
      _organizationId: new mongoose.Types.ObjectId(organizationId),
      version: version,
    });

    return result.deletedCount === 1;
  }

  async destroy(id: string, ...args: any) {
    const result = await PricingMongoose.deleteOne({ _id: id });
    return result?.deletedCount === 1;
  }

  _processPricingQueryParams(queryParams: PricingIndexQueryParams): {
    filteringPipeline: PipelineStage[];
    sortPipeline: PipelineStage[];
  } {
    const filteringPipeline: PipelineStage[] = [];
    const sortPipeline: PipelineStage[] = [];

    if (Object.keys(queryParams).length > 0) {
      const {
        name,
        subscriptions,
        minPrice,
        maxPrice,
        selectedOrganizations,
        collection,
        excludePricingsInCollection,
        sortBy,
        sort,
      } = queryParams;

      if (collection) {
        filteringPipeline.push({
          $match: {
            'collection.slug': collection,
          },
        });
      }

      if (excludePricingsInCollection) {
        filteringPipeline.push({
          $match: {
            _collectionId: null,
          },
        });
      }

      if (name) {
        filteringPipeline.push({
          $match: {
            name: {
              $regex: name,
              $options: 'i', // case-insensitive
            },
          },
        });
      }

      if (subscriptions) {
        const subscriptionsFilter = subscriptions as { min: number; max: number };

        filteringPipeline.push({
          $match: {
            'analytics.configurationSpaceSize': {
              $gte: !Number.isNaN(subscriptionsFilter.min) ? subscriptionsFilter.min : 0,
              $lte: !Number.isNaN(subscriptionsFilter.max)
                ? subscriptionsFilter.max
                : Number.MAX_SAFE_INTEGER,
            },
          },
        });
      }

      if (minPrice) {
        const minPriceFilter = minPrice as { min: number; max: number };

        filteringPipeline.push({
          $match: {
            'analytics.minSubscriptionPrice': {
              $gte: !Number.isNaN(minPriceFilter.min) ? minPriceFilter.min : 0,
              $lte: !Number.isNaN(minPriceFilter.max)
                ? minPriceFilter.max
                : Number.MAX_SAFE_INTEGER,
            },
          },
        });
      }

      if (maxPrice) {
        const maxPriceFilter = maxPrice as { min: number; max: number };

        filteringPipeline.push({
          $match: {
            'analytics.maxSubscriptionPrice': {
              $gte: !Number.isNaN(maxPriceFilter.min) ? maxPriceFilter.min : 0,
              $lte: !Number.isNaN(maxPriceFilter.max)
                ? maxPriceFilter.max
                : Number.MAX_SAFE_INTEGER,
            },
          },
        });
      }

      if (selectedOrganizations) {
        const selectedOrganizationsFilter = selectedOrganizations as string[];

        filteringPipeline.push({
          $match: {
            _organizationId: {
              $in: selectedOrganizationsFilter.map(id => new mongoose.Types.ObjectId(id)),
            },
          },
        });
      }

      if (sortBy && sort) {
        let sortParameter = '';
        const sortOrder = sort === 'asc' ? 1 : -1;

        switch (sortBy) {
          case 'name':
            sortParameter = 'name';
            break;
          case 'configurationSpaceSize':
            sortParameter = 'analytics.configurationSpaceSize';
            break;
          case 'featuresCount':
            sortParameter = 'analytics.numberOfFeatures';
            break;
          case 'usageLimitsCount':
            sortParameter = 'analytics.numberOfUsageLimits';
            break;
          case 'plansCount':
            sortParameter = 'analytics.numberOfPlans';
            break;
          case 'addonsCount':
            sortParameter = 'analytics.numberOfAddons';
            break;
          case 'minPrice':
            sortParameter = 'analytics.minSubscriptionPrice';
            break;
          case 'maxPrice':
            sortParameter = 'analytics.maxSubscriptionPrice';
            break;
        }
        sortPipeline.push({
          $addFields: {
            pricings: {
              $sortArray: {
                input: '$pricings',
                sortBy: {
                  [sortParameter]: sortOrder,
                },
              },
            },
          },
        });
      }
    }

    return { filteringPipeline, sortPipeline };
  }

  _processPricingPagination(queryParams: PricingIndexQueryParams): PipelineStage[] {
    let paginationPipeline: PipelineStage[] = [];

    const offset = queryParams.offset;
    const limit = queryParams.limit;

    // If pagination params present, compute total and slice pricings inside the aggregation for efficiency
    if (typeof offset !== 'undefined' || typeof limit !== 'undefined') {
      paginationPipeline = [
        {
          $addFields: {
            total: { $size: '$pricings' },
          },
        },
        {
          $project: {
            pricings: {
              $slice: ['$pricings', offset, limit],
            },
            minPrice: 1,
            maxPrice: 1,
            configurationSpaceSize: 1,
            total: 1,
          },
        },
      ];
    }

    return paginationPipeline;
  }
}

export default PricingRepository;
