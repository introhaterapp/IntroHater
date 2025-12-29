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
        rollingDuration: 24 * 60 * 60, 
        absoluteDuration: 7 * 24 * 60 * 60, 
        cookie: {
            domain: process.env.COOKIE_DOMAIN || 'introhater.com',
            secure: true,
            sameSite: 'Lax',
            transient: false 
        }
    },
    
    idpLogout: true
};

module.exports = { config };