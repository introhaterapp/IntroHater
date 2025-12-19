require('dotenv').config();

const config = {
    authRequired: false,
    auth0Logout: true,
    secret: process.env.TOKEN_SECRET,
    baseURL: process.env.BASE_URL || 'https://introhater.com',
    clientID: process.env.AUTH0_CLIENT_ID,
    clientSecret: process.env.AUTH0_CLIENT_SECRET,
    issuerBaseURL: `https://${process.env.AUTH0_DOMAIN}`,
    authorizationParams: {
        response_type: 'code',
        scope: 'openid profile email',
        audience: `https://${process.env.AUTH0_DOMAIN}/api/v2/`,
        connection: 'github'
    },
    routes: {
        login: '/auth/login',
        callback: '/auth/callback',
        logout: '/auth/logout'
    },
    session: {
        rolling: true,
        rollingDuration: 24 * 60 * 60, // 24 hours in seconds
        absoluteDuration: 7 * 24 * 60 * 60, // 7 days in seconds
        cookie: {
            domain: process.env.COOKIE_DOMAIN || 'introhater.com',
            secure: true,
            sameSite: 'Lax',
            transient: false // Allow the cookie to persist between browser sessions
        }
    },
    // Enable federated logout but don't duplicate auth0Logout
    idpLogout: true
};

module.exports = { config };