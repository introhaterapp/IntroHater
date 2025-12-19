const axios = {
    get: jest.fn(() => Promise.resolve({ data: {} })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    head: jest.fn(() => Promise.resolve({ headers: {} })),
    create: jest.fn(function () {
        return this;
    })
};
module.exports = axios;
