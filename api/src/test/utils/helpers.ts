import UserMongoose from "../../main/repositories/mongoose/models/UserMongoose";
import { TEST_PASSWORD } from "./config/variables";
import { generateJwtToken } from "../../main/utils/users/helpers";

export const randomSuffix = () => Math.random().toString(36).substring(2, 10);


export const createGlobalAdminUser = async () => {
  const adminUserData = {
    username: 'testAdmin_' + randomSuffix(),
    password: TEST_PASSWORD,
    role: 'ADMIN',
    firstName: 'Admin',
    lastName: 'User',
    email: `admin_${randomSuffix()}@test.com`,
    tokenExpiration: new Date(Date.now() + 24 * 60 * 60 * 1000),
    avatar: `${process.env.SERVER_STATICS_FOLDER || 'public/'}${process.env.AVATARS_FOLDER || 'static/avatars/users'}/default-avatar.png`,
  };

  const createdAdmin = new UserMongoose(adminUserData);
  const savedAdmin = await createdAdmin.save();
  const id = savedAdmin._id.toString();
  const token = generateJwtToken({ id, username: adminUserData.username, role: adminUserData.role });
  return {
    ...adminUserData,
    id,
    token,
  };
};

export const createGlobalTestUser = async () => {
  const testUserData = {
    username: 'testUser_' + randomSuffix(),
    password: TEST_PASSWORD,
    role: 'USER',
    firstName: 'John',
    lastName: 'Doe',
    email: `test_user_${randomSuffix()}@test.com`,
    tokenExpiration: new Date(Date.now() + 24 * 60 * 60 * 1000),
    avatar: `${process.env.SERVER_STATICS_FOLDER || 'public/'}${process.env.AVATARS_FOLDER || 'static/avatars/users'}/default-avatar.png`,
  };

  const createdTestUser = new UserMongoose(testUserData);
  const savedTestUser = await createdTestUser.save();
  const id = savedTestUser._id.toString();
  const token = generateJwtToken({ id, username: testUserData.username, role: testUserData.role });
  // Ensure the test user is not deleted during cleanup
  return {
    ...testUserData,
    id,
    token,
  };
};