import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { retrievePricingFromText } from 'pricing4ts/server';
import { diffPricings } from '../../main/services/orbit/orbitPricingDiff';

const template = fs.readFileSync(path.resolve(process.cwd(), 'public', 'static', 'pricings', 'templates', 'petclinic.yml'), 'utf8').replace(/\r\n/g, '\n');
const parse = (text: string) => retrievePricingFromText(text);

describe('ORBIT pricing diff', () => {
  it('reports nothing between a version and itself', () => {
    const diff = diffPricings(parse(template), parse(template));
    expect(diff.unchanged).toBe(true);
    expect(diff.planValues).toEqual([]);
  });

  it('finds new, removed and repriced plans and add-ons, and changed plan values', () => {
    const next = template
      .replace('version: "1.0.0"', 'version: "2.0.0"')
      .replace(/  GOLD:\n    description: Advanced plan\n    price: 5\.0/, '  GOLD:\n    description: Advanced plan\n    price: 6.0')
      .replace(/      maxPets:\n        value: 7/, '      maxPets:\n        value: 9')
      .replace(/  petAdoptionCentre:\n    description: petAdoptionCentre description\n    price: 15\.95/, '  adoptionPlus:\n    description: petAdoptionCentre description\n    price: 15.95');

    const diff = diffPricings(parse(template), parse(next));

    expect(diff.unchanged).toBe(false);
    expect(diff.to).not.toBe(diff.from);
    expect(diff.plans.priceChanges).toEqual([{ name: 'GOLD', from: 5, to: 6 }]);
    expect(diff.addOns.removed).toEqual(['petAdoptionCentre']);
    expect(diff.addOns.added).toEqual([{ name: 'adoptionPlus', price: 15.95 }]);
    expect(diff.planValues).toContainEqual({ plan: 'PLATINUM', item: 'maxPets', from: 7, to: 9 });
  });
});
