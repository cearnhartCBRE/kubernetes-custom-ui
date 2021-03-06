import path from 'path';
import express from 'express';
import morgan from 'morgan';
import helmet from 'helmet';
import compression from 'compression';
import bodyParser from 'body-parser';
import cors from 'cors';
import Container from './container';
import routes from './routes';
import { ValidationError, NotAuthenticatedError, CommercetoolsError } from './errors';

const isProduction = () => process.env.NODE_ENV === 'production';

const getStaticMaxAge = config =>
  (isProduction() && parseInt(config.get('STATIC_MAX_CACHE_IN_SECONDS'), 10)
    ? parseInt(config.get('STATIC_MAX_CACHE_IN_SECONDS') * 1000, 10)
    : 0);

function initMiddlewares({ app, config }) {
  app.use(cors());
  app.use(compression());

  if (isProduction()) {
    app.use(morgan('combined', {
      skip: (req, res) => res.statusCode < 500, // Log "not managed" errors
    }));
  } else {
    app.use(morgan('dev'));
  }

  app.use(helmet());
  app.use(express.static(path.resolve(__dirname, '../../client/dist'), {
    maxAge: getStaticMaxAge(config),
  }));
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: false }));
}

function initModulesServerRoutes({ app, container }) {
  routes({ app, container });
}

function sendError(res, err, statusCode) {
  return res.status(statusCode).json({
    code: err.code || statusCode,
    error: err.constructor.name,
    message: err.message,
    ...(err.errors && { errors: err.errors }),
  });
}

function handleError({ err, res, logger }) {
  if (err instanceof ValidationError) {
    return sendError(res, err, 400);
  } else if (err instanceof NotAuthenticatedError) {
    return sendError(res, err, 401);
  } else if (err instanceof CommercetoolsError) {
    if (err.code >= 500) {
      logger.error(JSON.stringify(err));
    }

    return sendError(res, err, err.code);
  } else {
    // If any of the previous middlewares has a "not managed error" we log it and return HTTP 500
    logger.error(err.stack);
    return sendError(res, err, 500);
  }
}

function initErrorRoutes({ app, logger }) {
  app.use((err, req, res, next) => {
    if (!err) {
      return next();
    }

    return handleError({ err, res, logger });
  });
}

function getServer() {
  // Initializing the DI Container
  const container = Container();

  const config = container.resolve('config');
  const logger = container.resolve('logger');
  const port = config.get('PORT') || 3000;

  const app = express();

  initMiddlewares({ app, config });
  initModulesServerRoutes({ app, container });
  initErrorRoutes({ app, logger });

  app.init = () =>
    app.listen(port, () => {
      logger.info(`Server listening on port ${port}`);
    });

  return app;
}

export default getServer();
