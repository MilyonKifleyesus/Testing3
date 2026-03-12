export const environment = {
  production: true,
  apiBaseUrl: 'https://api.fleetpulse.net/api',
  useApiV2: true,
  apiPagedFetchPageSize: 500,
  apiPagedFetchMaxPages: 200,
  logoPayloadMode: 'autoRetryRawBase64' as const,
  allowedLogoOrigins: [],
  useMockClientDashboard: false,
  firebase: {
    apiKey: "************************************",
    authDomain: "**********************************************",
    projectId: "**********************************************",
    storageBucket: "**********************************************",
    messagingSenderId: "**********************************************",
    appId: "**********************************************",
    measurementId: "**********************************************"
  },
};
