import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import mongoose from 'mongoose';
import User from '../src/main/repositories/mongoose/models/UserMongoose';
import container from '../src/main/config/container';

// This runner only creates/removes its own fixtures in the dedicated running lab.
const sphere = 'http://127.0.0.1:5183';
const space = 'http://127.0.0.1:5184';
const password = 'Lab-Sphere-Space-2026!';
const suffix = Date.now().toString(36);
const sphereUser = 'browser_' + suffix;
const otherSphere = 'link_' + suffix;
const renamed = 'renamed_' + suffix;
const localUser = 'local_' + suffix;
const chosen = 'chosen_' + suffix;
const screenshotDir = 'test-results/identity-lab';
const sphereNames = [sphereUser, otherSphere, renamed];
const spaceNames = [sphereUser, localUser, chosen];
await mongoose.connect('mongodb://127.0.0.1:27018/sphere_identity_lab');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
await mkdir(screenshotDir, { recursive: true });
try {
  for (const username of [sphereUser, otherSphere]) {
    const user = await User.create({ username, password, firstName: 'Browser', lastName: 'Test', email: username + '@example.com', emailVerified: true });
    await container.resolve('organizationService').ensurePersonalOrganizationForUser({ id: user.id, username });
  }
  for (const username of [sphereUser, localUser]) {
    const response = await fetch(space + '/api/v1/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    assert.equal(response.status, 201);
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  async function sphereLogin(username: string) {
    await page.getByLabel('Username or Email', { exact: true }).fill(username);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  async function approve() {
    await page.getByRole('heading', { name: 'Continue to SPACE', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Continue to SPACE', exact: true }).click();
    await page.waitForURL(space + '/auth/sphere');
  }
  async function logout() {
    await page.goto(space + '/settings');
    await page.getByRole('button', { name: 'Log out', exact: true }).click();
    await page.goto(space);
    await page.getByRole('button', { name: 'Log In', exact: true }).waitFor();
  }
  await page.goto(space);
  await page.getByRole('button', { name: 'Continue with SPHERE', exact: true }).waitFor();
  await page.screenshot({ path: screenshotDir + '/01-login.png', fullPage: true });
  await page.getByRole('button', { name: 'Continue with SPHERE', exact: true }).click();
  await sphereLogin(sphereUser);
  await page.getByRole('heading', { name: 'Continue to SPACE', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Continue to SPACE', exact: true }).waitFor();
  await page.screenshot({ path: screenshotDir + '/02-consent.png', fullPage: true });
  await approve();
  await page.getByLabel('SPACE username', { exact: true }).fill(sphereUser);
  await page.getByRole('button', { name: 'Create SPACE account', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Username is already taken' }).waitFor();
  await page.screenshot({ path: screenshotDir + '/03-collision.png', fullPage: true });
  await page.getByLabel('SPACE username', { exact: true }).fill(chosen);
  await page.getByRole('button', { name: 'Create SPACE account', exact: true }).click();
  await page.waitForURL(space + '/');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('user')!).username), chosen);
  console.log('PASS: new sign-in, username collision, independent username and account creation');
  // The stored subject survives an actual provider rename.
  await User.updateOne({ username: sphereUser }, { $set: { username: renamed } });
  await logout();
  await page.getByRole('button', { name: 'Continue with SPHERE', exact: true }).click();
  await approve();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(space + '/');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('user')!).username), chosen);
  console.log('PASS: returning user after SPHERE username change');
  // The same provider identity cannot be claimed by another existing SPACE account.
  await logout();
  await page.getByLabel('Username', { exact: true }).fill(localUser);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await page.getByRole('button', { name: 'Log In', exact: true }).waitFor({ state: 'hidden' });
  await page.goto(space + '/settings');
  await page.getByRole('button', { name: 'Connect SPHERE', exact: true }).click();
  await approve();
  await page.getByRole('button', { name: 'Confirm connection', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'already connected to another SPACE account' }).waitFor();
  console.log('PASS: explicit link refuses an identity owned by another SPACE account');
  // New browser: existing local login, then link a different SPHERE identity.
  const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  const secondPage = await secondContext.newPage();
  await secondPage.goto(space);
  await secondPage.getByLabel('Username', { exact: true }).fill(localUser);
  await secondPage.getByLabel('Password', { exact: true }).fill(password);
  await secondPage.getByRole('button', { name: 'Log In', exact: true }).click();
  await secondPage.getByRole('button', { name: 'Log In', exact: true }).waitFor({ state: 'hidden' });
  await secondPage.goto(space + '/settings');
  await secondPage.getByRole('button', { name: 'Connect SPHERE', exact: true }).click();
  await secondPage.getByLabel('Username or Email', { exact: true }).fill(otherSphere);
  await secondPage.getByLabel('Password', { exact: true }).fill(password);
  await secondPage.getByRole('button', { name: 'Sign in', exact: true }).click();
  await secondPage.getByRole('button', { name: 'Continue to SPACE', exact: true }).click();
  await secondPage.getByRole('button', { name: 'Confirm connection', exact: true }).waitFor();
  await secondPage.screenshot({ path: screenshotDir + '/04-link-mobile.png', fullPage: true });
  await secondPage.getByRole('button', { name: 'Confirm connection', exact: true }).click();
  await secondPage.waitForURL(space + '/settings');
  await secondPage.getByRole('button', { name: 'SPHERE connected', exact: true }).waitFor();
  assert.equal(await secondPage.evaluate(() => JSON.parse(localStorage.getItem('user')!).username), localUser);
  await secondPage.getByRole('button', { name: 'Log out', exact: true }).click();
  await secondPage.goto(space);
  await secondPage.getByRole('button', { name: 'Continue with SPHERE', exact: true }).click();
  await secondPage.getByRole('button', { name: 'Continue to SPACE', exact: true }).click();
  await secondPage.getByRole('button', { name: 'Sign in', exact: true }).click();
  await secondPage.waitForURL(space + '/');
  assert.equal(await secondPage.evaluate(() => JSON.parse(localStorage.getItem('user')!).username), localUser);
  console.log('PASS: local password login, explicit linking and subsequent SPHERE login on mobile');
  assert.deepEqual(errors, []);
  await secondContext.close(); await context.close();
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    console.log('Browser failure URL:', page.url());
    console.log(await page.locator('h1').evaluateAll(elements => elements.map(element => {
      const chain = []; let current: Element | null = element;
      while (current) { const style = getComputedStyle(current); chain.push({ tag: current.tagName, class: current.className, display: style.display, visibility: style.visibility, rect: current.getBoundingClientRect().toJSON() }); current = current.parentElement; }
      return chain;
    })));
    await page.screenshot({ path: screenshotDir + '/failure.png', fullPage: true });
    console.log((await page.locator('body').innerText()).slice(0, 2000));
  }
  throw error;
} finally {
  await browser.close();
  const users = await User.find({ username: { $in: sphereNames } });
  const ids = users.map(user => user._id);
  const memberships = await mongoose.connection.db!.collection('organizationMemberships').find({ _userId: { $in: ids } }).toArray();
  const orgIds = memberships.map(member => member._organizationId);
  await mongoose.connection.db!.collection('organizationMemberships').deleteMany({ _userId: { $in: ids } });
  // The users' organizations are personal test fixtures; preserve every unrelated lab document.
  if (orgIds.length) await mongoose.connection.db!.collection('organizations').deleteMany({ _id: { $in: orgIds } });
  await User.deleteMany({ _id: { $in: ids } });
  const spaceDb = mongoose.connection.useDb('space_identity_lab');
  await spaceDb.collection('users').deleteMany({ username: { $in: spaceNames } });
  await spaceDb.collection('organizations').deleteMany({ owner: { $in: spaceNames } });
  await mongoose.disconnect();
}
