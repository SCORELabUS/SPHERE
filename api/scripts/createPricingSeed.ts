import fs from 'fs';
import mongoose, { ObjectId } from 'mongoose';
import {retrievePricingFromPath} from 'pricing4ts/server';

interface Analytics {
  [key: string]: number;
}

interface OutputData {
  _id: ObjectId;
  name: string;
  createdAt: string;
  url: string;
  yaml: string;
  analytics: Analytics;
}

interface AnalyticsData {
  [key: string]: {
    date: string;
    yaml_path: string;
    analytics: Analytics;
  }[];
}

const SAAS_DATA: AnalyticsData = {};

const transformData = (data: AnalyticsData): OutputData[] => {
  const publicYamlPath = 'static/pricings/originalDataset';
  const pricingsDirectory = 'api/public/' + publicYamlPath;

  return Object.entries(data).flatMap(([name, pricingArray]) =>
    pricingArray.map((pricing) => {
      
      const pricingData = retrievePricingFromPath(`${pricingsDirectory}/${pricing.yaml_path.split('/').slice(2).join('/')}`);

      return {
      _id: {
        $oid: new mongoose.Types.ObjectId()
      },
      name,
      owner: "sphere",
      version: pricing.date.split('-')[0],
      createdAt: new Date(pricing.date),
      currency: pricingData.currency,
      url: null,
      yaml: `${publicYamlPath}/${pricing.yaml_path.split('/').slice(2).join('/')}`,
      analytics: pricing.analytics,
    };})
  );
};

const saveToJsonFile = (data: OutputData[], fileName: string): void => {
  fs.writeFileSync(fileName, JSON.stringify(data, null, 2));
  console.log(`Data successfully saved to ${fileName}`);
};

const main = () => {
  const transformedData = transformData(SAAS_DATA);
  saveToJsonFile(transformedData, './api/scripts/output.json');
};

main();