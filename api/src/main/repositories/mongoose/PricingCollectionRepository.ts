import mongoose, { PipelineStage } from 'mongoose';
import {
  PricingCollectionAnalyticsToAdd,
  RetrievedCollection,
} from '../../types/database/PricingCollection';
import RepositoryBase from '../RepositoryBase';
import PricingCollectionMongoose from './models/PricingCollectionMongoose';
import PricingMongoose from './models/PricingMongoose';
import { processFileUris } from '../../services/FileService';
import { getAllPricingsFromCollection } from './aggregators/get-pricings-from-collection';
import { addNumberOfPricingsAggregator } from './aggregators/pricingCollections/add-number-of-pricings';
import { addOrganizationToCollectionAggregator } from './aggregators/pricingCollections/add-organization-to-collection';
import { addLastPricingUpdateAggregator } from './aggregators/pricingCollections/add-last-pricing-update';
import { CollectionIndexQueryParams } from '../../types/services/PricingCollection';
import { OrgUserPermissionsContext } from '../../types/policies';
import { refactorCollectionOutput } from './aggregators/pricingCollections/refactor-output';
import { considerUserCollectionPermissionsAggregator } from './aggregators/pricingCollections/apply-user-permissions';

class PricingCollectionRepository extends RepositoryBase {
  async findAll(
    queryParams: CollectionIndexQueryParams,
    includePrivate: boolean = false
  ): Promise<{ collections: RetrievedCollection[]; total: number }> {
    const { filteringPipeline, sortPipeline } = this._processCollectionQueryParams(queryParams);
    const paginationPipeline = this._processCollectionPagination(queryParams);

    try {
      const pipeline: any[] = [
        {
          $match: {
            ...(includePrivate ? {} : { private: { $ne: true } }),
          },
        },
        ...addNumberOfPricingsAggregator(),
        ...addOrganizationToCollectionAggregator(),
        ...filteringPipeline,
        { $sort: { name: 1 } },
        ...sortPipeline,
        refactorCollectionOutput,
        ...paginationPipeline,
      ];

      const aggResult = await PricingCollectionMongoose.aggregate(pipeline);
      const first = aggResult[0] || { collections: [], total: [] };
      const collections = first.collections || [];
      const total = (first.total && first.total[0] && first.total[0].count) || 0;

      collections.forEach((c: any) => processFileUris(c.organization, ['avatar']));
      return { collections, total };
    } catch (err) {
      return { collections: [], total: 0 };
    }
  }

  async findById(id: string): Promise<RetrievedCollection | null> {
    try {
      const collection = await PricingCollectionMongoose.findById(id)
        .populate('organization', {
          name: 1,
          displayName: 1,
          avatar: 1,
          id: 1,
        })
        .exec();

      if (!collection) {
        return null;
      }
      const collectionObj = collection.toObject<RetrievedCollection>();
      return collectionObj;
    } catch (err) {
      return null;
    }
  }

  async findByOrganizationId(
    organizationId: string,
    permissions: OrgUserPermissionsContext,
    queryParams: CollectionIndexQueryParams
  ) {

    const { filteringPipeline, sortPipeline } = this._processCollectionQueryParams(queryParams);
    const paginationPipeline = this._processCollectionPagination(queryParams);

    try {
      const aggResult = await PricingCollectionMongoose.aggregate([
        {
          $match: {
            _organizationId: new mongoose.Types.ObjectId(organizationId),
          },
        },
        ...addNumberOfPricingsAggregator(),
        ...addOrganizationToCollectionAggregator(),
        ...filteringPipeline,
        considerUserCollectionPermissionsAggregator(permissions),
        { $sort: { name: 1 } },
        ...sortPipeline,
        refactorCollectionOutput,
        ...paginationPipeline,
      ]);

      const first = aggResult[0] || { collections: [], total: [] };
      const collections = first.collections || [];
      const total = (first.total && first.total[0] && first.total[0].count) || 0;

      collections.forEach((c: any) => processFileUris(c.organization, ['avatar']));
      return { collections, total };
    } catch (err) {
      return null;
    }
  }

  async findByOrganizationAndSlug(organizationId: string, slug: string) {
    try {
      const collections = await PricingCollectionMongoose.aggregate([
        {
          $match: {
            slug: {
              $eq: slug,
            },
            _organizationId: new mongoose.Types.ObjectId(organizationId),
          },
        },
        ...getAllPricingsFromCollection(),
        ...addOrganizationToCollectionAggregator(),
        ...addLastPricingUpdateAggregator(),
        {
          $addFields: {
            id: { $toString: '$_id' },
          },
        },
        {
          $project: {
            _id: 0,
            id: 1,
            organization: {
              name: 1,
              displayName: 1,
              avatar: 1,
            },
            name: 1,
            slug: 1,
            description: 1,
            private: 1,
            analytics: 1,
            data: 1,
            lastUpdate: 1,
          },
        },
      ]);

      return collections[0];
    } catch (err) {
      console.log('[ERROR] An error occurred during the retrieval of the pricing collection');
      return null;
    }
  }

  async findCollectionPricingsByOrganization(slug: string, organizationId: string) {
    try {
      const collections = await PricingCollectionMongoose.aggregate([
        {
          $match: {
            slug: {
              $eq: slug,
            },
            _organizationId: new mongoose.Types.ObjectId(organizationId),
          },
        },
        {
          $lookup: {
            from: 'pricings',
            let: { localId: { $toString: '$_id' } },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: ['$_collectionId', '$$localId'],
                  },
                },
              },
            ],
            as: 'pricings',
          },
        },
        {
          $project: {
            pricings: 1,
          },
        },
      ]).exec();

      return collections[0];
    } catch (err) {
      return null;
    }
  }

  async create(data: any) {
    const collection = new PricingCollectionMongoose(data);
    await collection.save();

    const populatedCollection = await collection.populate('organization', {
      name: 1,
      displayName: 1,
      avatar: 1,
      id: 1,
    });

    return populatedCollection.toObject<RetrievedCollection>();
  }

  async updateAnalytics(collectionId: string, analytics: PricingCollectionAnalyticsToAdd) {
    const updateData: any = {};
    for (const key in analytics) {
      if (analytics.hasOwnProperty(key)) {
        updateData[`analytics.${key}.dates`] = new Date(analytics[key].date);
        updateData[`analytics.${key}.values`] = analytics[key].value;
      }
    }

    return await PricingCollectionMongoose.updateOne(
      { _id: collectionId },
      {
        $push: updateData,
      }
    );
  }

  async update(collectionId: string, data: any) {
    const collection = await PricingCollectionMongoose.findById(collectionId);

    if (!collection) {
      throw new Error('Collection not found in database');
    }

    collection.set(data);
    await collection.save();

    return collection.toObject();
  }

  async setCollectionAnalytics(collectionId: string, analytics: any) {
    const collection = await PricingCollectionMongoose.findById(collectionId);

    if (!collection) {
      throw new Error('Collection not found in database');
    }

    collection.set({ analytics });
    await collection.save();

    return collection.toObject();
  }

  async destroy(id: string, ...args: any) {
    const result = await PricingCollectionMongoose.deleteOne({ _id: id });
    return result?.deletedCount === 1;
  }

  async destroyWithPricings(id: string, ...args: any) {
    const resultPricings = await PricingMongoose.deleteMany({
      _collectionId: new mongoose.Types.ObjectId(id),
    });
    const resultCollections = await PricingCollectionMongoose.deleteOne({
      _id: new mongoose.Types.ObjectId(id),
    });
    return resultCollections?.deletedCount === 1 && resultPricings?.deletedCount > 0;
  }

  _processCollectionQueryParams(queryParams: CollectionIndexQueryParams): {
    filteringPipeline: PipelineStage[];
    sortPipeline: PipelineStage[];
  } {
    const filteringPipeline: PipelineStage[] = [];
    const sortPipeline: PipelineStage[] = [];

    if (Object.keys(queryParams).length > 0) {
      const { name, organizationIds, sortBy, sort } = queryParams;

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

      if (organizationIds) {
        filteringPipeline.push({
          $match: {
            "organization.id": {
              $in: organizationIds,
            },
          },
        });
      }
      if (sortBy && sort) {
        let sortParameter = '';
        const sortOrder: 1 | -1 = sort === 'asc' ? 1 : -1;

        switch (sortBy) {
          case 'name':
            sortParameter = 'name';
            break;
          case 'numberOfPricings':
            sortParameter = 'numberOfPricings';
            break;
          case 'configurationSpaceSize':
            sortParameter = 'analytics.evolutionOfConfigurationSpaceSize.values';
            break;
          case 'numberOfFeatures':
            sortParameter = 'analytics.evolutionOfFeatures.values';
            break;
          case 'numberOfPlans':
            sortParameter = 'analytics.evolutionOfPlans.values';
            break;
          case 'numberOfAddons':
            sortParameter = 'analytics.evolutionOfAddOns.values';
            break;
        }
        sortPipeline.push({
          $sort: {
            [sortParameter]: sortOrder,
          },
        });
      }
    }

    return { filteringPipeline, sortPipeline };
  }

  _processCollectionPagination(queryParams: CollectionIndexQueryParams): PipelineStage[] {
    let paginationPipeline: PipelineStage[] = [];

    const offset = queryParams.offset;
    const limit = queryParams.limit;

    // Use a $facet to get paginated result and total count in a single aggregation
    if (typeof offset !== 'undefined' || typeof limit !== 'undefined') {
      paginationPipeline = [
        {
          $facet: {
            collections: [{ $skip: offset }, { $limit: limit }],
            total: [{ $count: 'count' }],
          },
        },
      ];
    }

    return paginationPipeline;
  }
}

export default PricingCollectionRepository;
