/* eslint-disable import/no-unresolved */
/* eslint-disable jest/require-hook */
import SecurityConfig from "../utils/config";

const express = require('express');
const cors = require('cors');
const driverController = require('../controllers/DriverController');

const securityConfig = new SecurityConfig();
const { corsOptions } = securityConfig;

const driverRouter = express.Router();

driverRouter.use(cors(corsOptions));
driverRouter.options('*', cors(corsOptions));

driverRouter.patch('/availability', driverController.updateOnlineStatus);
driverRouter.put('/update-profile', driverController.updateProfile);
driverRouter.put('/update-avatar', driverController.updateAvatar);
driverRouter.post('/location/create', driverController.createLocation);
driverRouter.put('/location/update', driverController.updateLocation);
driverRouter.delete('/location/delete', driverController.deleteLocation);

module.exports = driverRouter;