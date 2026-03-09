// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.
export const environment = {
  production: false,
  apiBaseUrl: '/api',
  mapHubUrl: '/api/hubs/map',
  mapRealtimeEnabled: false,
  mapPollingIntervalMs: 15000,
  mapDisconnectGraceMs: 10000,
  useApiV2: true,
  apiPagedFetchPageSize: 500,
  apiPagedFetchMaxPages: 200,
  logoPayloadMode: 'autoRetryRawBase64' as const,
  mapMaxLocationsPerProject: 20,
  mapMaxTotalRoutes: 3000,
  allowedLogoOrigins: [],
  useMockClientDashboard: false,
  firebase: {
    apiKey: "***************************************",
    authDomain: "************************",
    projectId: "***********************************",
    storageBucket: "************************",
    messagingSenderId: "*********************",
    appId: "*******************************************",
    measurementId: "*********************"
  },
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
