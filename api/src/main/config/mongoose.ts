import mongoose, { Mongoose } from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const getMongoDBConnectionURI = () => {
  const databaseProtocol = process.env.MONGO_PROTOCOL;
  const databaseHost = process.env.MONGO_HOST;
  const databasePort = process.env.MONGO_PORT ? `:${process.env.MONGO_PORT}` : '';
  const databaseUsername = process.env.DATABASE_USERNAME;
  const databasePassword = process.env.DATABASE_PASSWORD;
  const databaseName = process.env.DATABASE_NAME;
  const replicaSet = process.env.MONGO_REPLICA_SET;
  const directConnection = process.env.MONGO_DIRECT_CONNECTION === 'true';
  const dbCredentials = (databaseUsername && databasePassword) ? databaseUsername + ':' + databasePassword + '@' : '';
  const query = new URLSearchParams();
  if (databaseProtocol !== 'mongodb+srv') query.set('authSource', databaseName ?? 'admin');
  if (replicaSet) query.set('replicaSet', replicaSet);
  if (directConnection) query.set('directConnection', 'true');
  const queryString = query.size > 0 ? `?${query.toString()}` : '';
  const mongoDbConnectionURI = `${databaseProtocol}://${dbCredentials}${databaseHost}${databasePort}/${databaseName}${queryString}`;
  return mongoDbConnectionURI;
};

const initMongoose = () => {
  const mongoDbConnectionURI = getMongoDBConnectionURI();
  console.log(`Trying to connect to MongoDB at ${process.env.MONGO_HOST}:${process.env.MONGO_PORT ?? '27017'}`);
  mongoose.set('strictQuery', false); // removes a deprecation warning
  // mongoose.set('debug', true)
  return mongoose.connect(mongoDbConnectionURI);
};

const disconnectMongoose = async () => {
  console.log('Disconnecting from MongoDB');
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
    try {
      // Dropping the DB is only acceptable for local/dev convenience.
      // Tests should manage their own lifecycle and should not erase external data.
      if (process.env.ENVIRONMENT === 'development') {
        await mongoose.connection.db.dropDatabase();
      }
    } catch (_error) {
      // Ignore drop errors if the session is already closed.
    }
  }
  return mongoose.disconnect();
};

export { initMongoose, getMongoDBConnectionURI, disconnectMongoose };
