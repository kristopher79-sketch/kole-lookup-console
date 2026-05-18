export const msalConfig = {
  auth: {
    clientId: '7c9e80f7-8eca-4c36-ad56-1a9d928f60b1',
    authority: 'https://login.microsoftonline.com/d32297cf-4c17-47a0-aa36-274b7bbef19d',
redirectUri: 'http://localhost:5173',
navigateToLoginRequestUrl: false
  },
  cache: {
    cacheLocation: 'localStorage',
    storeAuthStateInCookie: false
  }
};

export const loginRequest = {
  scopes: ['User.Read']
};