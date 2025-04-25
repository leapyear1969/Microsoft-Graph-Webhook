require('dotenv').config();
const { Client } = require('@microsoft/microsoft-graph-client');
const msal = require('@azure/msal-node');
const express = require('express');

// MSAL 配置
const msalConfig = {
    auth: {
        clientId: process.env.CLIENT_ID,
        authority: `https://login.microsoftonline.com/${process.env.TENANT_ID}`,
        clientSecret: process.env.CLIENT_SECRET
    }
};

// 创建 MSAL 应用实例
const msalApp = new msal.ConfidentialClientApplication(msalConfig);

// 创建临时 Express 服务器处理认证回调
async function getAccessTokenWithAuthorizationCode() {
    return new Promise(async (resolve, reject) => {
        const app = express();
        let server;

        app.get('/auth/callback', async (req, res) => {
            try {
                if (req.query.code) {
                    const tokenResponse = await msalApp.acquireTokenByCode({
                        code: req.query.code,
                        scopes: ['https://graph.microsoft.com/.default'],
                        redirectUri: process.env.REDIRECT_URI
                    });

                    res.send('认证成功！可以关闭此窗口。');
                    server.close();
                    resolve(tokenResponse.accessToken);
                } else {
                    res.status(400).send('未收到授权码');
                    server.close();
                    reject(new Error('未收到授权码'));
                }
            } catch (error) {
                res.status(500).send('认证失败');
                server.close();
                reject(error);
            }
        });

        server = app.listen(3000, async () => {
            const authUrl = await msalApp.getAuthCodeUrl({
                scopes: ['https://graph.microsoft.com/.default'],
                redirectUri: process.env.REDIRECT_URI
            });
            console.log('请在浏览器中完成认证...');
            console.log('认证 URL:', authUrl);
            
            try {
                const open = (await import('open')).default;
                await open(authUrl);
            } catch (error) {
                console.log('无法自动打开浏览器，请手动复制上面的 URL 到浏览器中完成认证。');
            }
        });
    });
}

// 创建订阅
async function createSubscription(resource, changeType = 'created,updated') {
    try {
        const accessToken = await getAccessTokenWithAuthorizationCode();
        const client = Client.init({
            authProvider: (done) => {
                done(null, accessToken);
            }
        });

        const subscription = {
            changeType: changeType,
            notificationUrl: process.env.WEBHOOK_URL,
            resource: resource,
            expirationDateTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
            clientState: process.env.SUBSCRIPTION_SECRET
        };

        console.log('Creating subscription:', subscription);
        const result = await client
            .api('/subscriptions')
            .post(subscription);

        console.log('Subscription created successfully:', result);
        return result;
    } catch (error) {
        console.error('Error creating subscription:', error);
        throw error;
    }
}

// 列出所有订阅
async function listSubscriptions() {
    try {
        const accessToken = await getAccessTokenWithAuthorizationCode();
        const client = Client.init({
            authProvider: (done) => {
                done(null, accessToken);
            }
        });

        const subscriptions = await client
            .api('/subscriptions')
            .get();

        console.log('Current subscriptions:', subscriptions);
        return subscriptions;
    } catch (error) {
        console.error('Error listing subscriptions:', error);
        throw error;
    }
}

// 删除订阅
async function deleteSubscription(subscriptionId) {
    try {
        const accessToken = await getAccessTokenWithAuthorizationCode();
        const client = Client.init({
            authProvider: (done) => {
                done(null, accessToken);
            }
        });

        await client
            .api(`/subscriptions/${subscriptionId}`)
            .delete();

        console.log('Subscription deleted successfully');
    } catch (error) {
        console.error('Error deleting subscription:', error);
        throw error;
    }
}

// 主函数
async function main() {
    try {
        // 列出当前订阅
        console.log('Listing current subscriptions...');
        await listSubscriptions();

        // 创建邮件订阅
        console.log('\nCreating email subscription...');
        await createSubscription('/me/messages');

        // 创建 Teams 订阅
        console.log('\nCreating Teams subscription...');
        await createSubscription('/me/chats');

        // 再次列出所有订阅
        console.log('\nListing updated subscriptions...');
        await listSubscriptions();

        process.exit(0);
    } catch (error) {
        console.error('Error in main function:', error);
        process.exit(1);
    }
}

// 运行主函数
main(); 