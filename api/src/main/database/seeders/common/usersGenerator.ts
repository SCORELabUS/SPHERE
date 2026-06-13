import { faker } from '@faker-js/faker';

export const generateUsers = async (nUsers: number) => {
  const users = [];
  users.push(await generateKnownUser());
  users.push(await generateKnownAdmin());

  for (let i = 0; i < nUsers; i++) {
    users.push(await generateFakeUser());
  }
  return users;
};

const generateKnownUser = async () => {
  const user = await generateFakeUser();
  user.email = 'user1@user.com';
  user.password = 'secret';
  user.userType = 'user';

  return user;
};

const generateKnownAdmin = async () => {
  const admin = await generateFakeUser();
  admin.email = 'admin1@admin.com';
  admin.password = 'secret';
  admin.userType = 'admin';

  return admin;
};
const generateFakeUser = async () => {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const email = faker.internet.email({ firstName: firstName, lastName: lastName });
  const password = faker.internet.password();
  const address = `${faker.location.streetAddress()}, ${faker.location.city()}, ${faker.location.country()}.`;
  const postalCode = faker.location.zipCode();
  const userType = faker.helpers.arrayElement(['user', 'admin']);
  const createdAt = new Date();
  const updatedAt = createdAt;
  return {
    firstName,
    lastName,
    email,
    password,
    settings: {
      phone: faker.phone.number(),
      avatar: faker.image.avatar() + `?timestamp=${Math.floor(Math.random() * 100)}`,
    },
    address,
    postalCode,
    userType,
    createdAt,
    updatedAt,
  };
};
