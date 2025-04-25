require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Client } = require('@microsoft/microsoft-graph-client');
const msal = require('@azure/msal-node');
const path = require('path');
const cookieParser = require('cookie-parser');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const port = process.env.PORT || 3000;

// MSAL 配置
const msalConfig = {
    auth: {
        clientId: process.env.CLIENT_ID,
        authority: `https://login.microsoftonline.com/${process.env.TENANT_ID}`,
        clientSecret: process.env.CLIENT_SECRET,
        redirectUri: process.env.REDIRECT_URI
    }
};

// 创建 MSAL 应用实例
const msalApp = new msal.ConfidentialClientApplication(msalConfig);

// 存储用户会话
const sessions = new Map();

// 清理过期会话
function cleanupExpiredSessions() {
    const now = Date.now();
    for (const [sessionId, session] of sessions.entries()) {
        if (session.expiresAt <= now) {
            console.log(`Cleaning up expired session: ${sessionId}`);
            sessions.delete(sessionId);
        }
    }
}

// 每5分钟清理一次过期会话
setInterval(cleanupExpiredSessions, 5 * 60 * 1000);

// 中间件
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// 存储 SSE 客户端连接
const clients = new Set();

// SSE 连接处理
app.get('/events', (req, res) => {
    console.log('New SSE client connected');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 发送初始连接成功消息
    res.write('data: {"type":"connected"}\n\n');

    // 将客户端添加到集合中
    clients.add(res);

    // 当客户端断开连接时移除
    req.on('close', () => {
        console.log('SSE client disconnected');
        clients.delete(res);
    });
});

// 向所有连接的客户端发送消息
function sendToAllClients(data) {
    console.log('准备向客户端发送消息:', data);
    
    try {
        // 检查是否有连接的客户端
        if (clients.size === 0) {
            console.warn('无法发送消息: 没有连接的客户端');
            return;
        }
        
        console.log(`正在向 ${clients.size} 个客户端发送消息`);
        const jsonData = JSON.stringify(data);
        
        clients.forEach(client => {
            try {
                client.write(`data: ${jsonData}\n\n`);
            } catch (clientError) {
                console.error('向客户端发送消息失败:', clientError);
                // 移除可能已断开的客户端
                clients.delete(client);
            }
        });
    } catch (error) {
        console.error('发送消息到客户端时发生错误:', error);
    }
}

// 认证路由
app.get('/auth/login', async (req, res) => {
    try {
        console.log('开始登录流程...');
        console.log('MSAL 配置:', {
            clientId: process.env.CLIENT_ID,
            authority: `https://login.microsoftonline.com/${process.env.TENANT_ID}`,
            redirectUri: process.env.REDIRECT_URI,
            hasClientSecret: !!process.env.CLIENT_SECRET
        });

        const authUrl = await msalApp.getAuthCodeUrl({
            scopes: [
                'User.Read', 
                'Mail.ReadWrite', 
                'Chat.Read', 
                'Chat.ReadWrite', 
                'ChatMessage.Read',
                'offline_access'
            ],
            redirectUri: process.env.REDIRECT_URI,
            prompt: 'select_account',
            responseType: 'code',
            responseMode: 'query'
        });

        console.log('生成的认证 URL:', authUrl);
        console.log('准备发送响应...');
        
        res.json({ authUrl });
        console.log('响应已发送');
    } catch (error) {
        console.error('获取认证 URL 失败:', error);
        console.error('错误详情:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        res.status(500).json({ 
            error: '获取认证 URL 失败',
            details: error.message
        });
    }
});

app.get('/auth/callback', async (req, res) => {
    console.log('收到认证回调请求');
    console.log('Query 参数:', req.query);
    
    try {
        if (req.query.code) {
            console.log('收到授权码，开始获取令牌...');
            const tokenResponse = await msalApp.acquireTokenByCode({
                code: req.query.code,
                scopes: [
                    'User.Read', 
                    'Mail.ReadWrite', 
                    'Chat.Read', 
                    'Chat.ReadWrite', 
                    'ChatMessage.Read'
                ],
                redirectUri: process.env.REDIRECT_URI
            });
            console.log('成功获取令牌');

            // 获取用户信息
            console.log('开始获取用户信息...');
            const client = Client.init({
                authProvider: (done) => {
                    done(null, tokenResponse.accessToken);
                }
            });

            const userInfo = await client
                .api('/me')
                .get();
            console.log('成功获取用户信息:', userInfo);

            // 创建会话
            const sessionId = Math.random().toString(36).substring(7);
            console.log('创建新会话:', sessionId);
            const expiresAt = Date.now() + (tokenResponse.expiresIn || 3600) * 1000;
            console.log('会话过期时间:', new Date(expiresAt).toISOString());
            
            sessions.set(sessionId, {
                accessToken: tokenResponse.accessToken,
                expiresAt: expiresAt,
                userInfo: {
                    displayName: userInfo.displayName,
                    mail: userInfo.mail,
                    userPrincipalName: userInfo.userPrincipalName
                }
            });

            // 设置 cookie
            console.log('设置会话 cookie...');
            res.cookie('sessionId', sessionId, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production'
            });

            console.log('认证完成，重定向到首页');
            res.redirect('/');
        } else {
            console.error('未收到授权码');
            res.status(400).send('未收到授权码');
        }
    } catch (error) {
        console.error('认证回调处理失败:', error);
        console.error('错误详情:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        res.status(500).send('认证失败');
    }
});

// 会话管理
async function refreshSession(session) {
    try {
        // 使用现有的访问令牌获取新令牌
        const client = Client.init({
            authProvider: (done) => {
                done(null, session.accessToken);
            }
        });

        // 获取新的用户信息
        const userInfo = await client
            .api('/me')
            .get();

        // 更新会话信息
        session.expiresAt = Date.now() + 60 * 60 * 1000; // 延长1小时
        session.userInfo = {
            displayName: userInfo.displayName,
            mail: userInfo.mail,
            userPrincipalName: userInfo.userPrincipalName
        };

        return true;
    } catch (error) {
        console.error('刷新会话失败:', error);
        return false;
    }
}

// 检查并刷新会话
async function checkAndRefreshSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return false;

    // 如果会话即将过期（小于10分钟），尝试刷新
    const timeToExpire = session.expiresAt - Date.now();
    if (timeToExpire < 10 * 60 * 1000) {
        console.log(`Session ${sessionId} is about to expire, attempting refresh...`);
        return await refreshSession(session);
    }

    return true;
}

// 修改 auth/status 路由
app.get('/auth/status', async (req, res) => {
    console.log('检查登录状态');
    console.log('Cookie:', req.cookies);
    const sessionId = req.cookies.sessionId;
    const session = sessions.get(sessionId);
    
    try {
        console.log('会话状态:', {
            hasSession: !!session,
            sessionId: sessionId,
            expiresAt: session ? new Date(session.expiresAt).toISOString() : null,
            isExpired: session ? session.expiresAt <= Date.now() : true
        });
    } catch (error) {
        console.error('打印会话状态时出错:', error);
        console.log('原始会话数据:', {
            hasSession: !!session,
            sessionId: sessionId,
            expiresAt: session ? session.expiresAt : null
        });
    }
    
    if (session && session.expiresAt > Date.now()) {
        // 检查并刷新会话
        const refreshed = await checkAndRefreshSession(sessionId);
        console.log('会话刷新状态:', refreshed);
        if (refreshed) {
            res.json({ 
                isLoggedIn: true,
                userInfo: session.userInfo
            });
        } else {
            console.log('会话刷新失败，删除会话');
            sessions.delete(sessionId);
            res.clearCookie('sessionId');
            res.json({ isLoggedIn: false });
        }
    } else {
        if (session) {
            console.log('会话已过期，删除会话');
            sessions.delete(sessionId);
        }
        res.clearCookie('sessionId');
        res.json({ isLoggedIn: false });
    }
});

app.post('/auth/logout', (req, res) => {
    const sessionId = req.cookies.sessionId;
    if (sessionId) {
        sessions.delete(sessionId);
    }
    res.clearCookie('sessionId');
    res.json({ success: true });
});

// 订阅管理路由
app.get('/subscriptions', async (req, res) => {
    try {
        const sessionId = req.cookies.sessionId;
        const session = sessions.get(sessionId);
        
        if (!session || session.expiresAt <= Date.now()) {
            return res.status(401).json({ error: '未登录或会话已过期' });
        }

        const client = Client.init({
            authProvider: (done) => {
                done(null, session.accessToken);
            }
        });

        const subscriptions = await client
            .api('/subscriptions')
            .get();

        res.json(subscriptions);
    } catch (error) {
        console.error('Error listing subscriptions:', error);
        res.status(500).json({ error: '获取订阅列表失败' });
    }
});

app.post('/subscriptions/mail', async (req, res) => {
    try {
        const sessionId = req.cookies.sessionId;
        const session = sessions.get(sessionId);
        
        if (!session || session.expiresAt <= Date.now()) {
            return res.status(401).json({ error: '未登录或会话已过期' });
        }

        // 验证必要的环境变量
        if (!process.env.WEBHOOK_URL) {
            console.error('Missing WEBHOOK_URL environment variable');
            return res.status(500).json({ error: '服务器配置错误：缺少 WEBHOOK_URL' });
        }

        if (!process.env.SUBSCRIPTION_SECRET) {
            console.error('Missing SUBSCRIPTION_SECRET environment variable');
            return res.status(500).json({ error: '服务器配置错误：缺少 SUBSCRIPTION_SECRET' });
        }

        console.log('Creating mail subscription with config:', {
            webhookUrl: process.env.WEBHOOK_URL,
            subscriptionSecret: process.env.SUBSCRIPTION_SECRET.substring(0, 4) + '...', // 只显示前4个字符
            accessToken: session.accessToken ? 'Present' : 'Missing'
        });

        const client = Client.init({
            authProvider: (done) => {
                done(null, session.accessToken);
            }
        });

        // 先检查现有订阅
        console.log('Checking existing subscriptions...');
        const existingSubscriptions = await client
            .api('/subscriptions')
            .get();
        
        console.log('Existing subscriptions:', JSON.stringify(existingSubscriptions, null, 2));

        // 删除任何现有的邮件订阅
        for (const sub of existingSubscriptions.value || []) {
            if (sub.resource.includes('messages')) {
                console.log('Deleting existing subscription:', sub.id);
                await client
                    .api(`/subscriptions/${sub.id}`)
                    .delete();
            }
        }

        const subscription = {
            changeType: 'created,updated',
            notificationUrl: process.env.WEBHOOK_URL.endsWith('/webhook') 
                ? process.env.WEBHOOK_URL 
                : `${process.env.WEBHOOK_URL}/webhook`,
            resource: '/me/mailFolders/Inbox/messages',
            expirationDateTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour for testing
            clientState: process.env.SUBSCRIPTION_SECRET,
            latestSupportedTlsVersion: 'v1_2',
            lifecycleNotificationUrl: process.env.WEBHOOK_URL.endsWith('/webhook') 
                ? process.env.WEBHOOK_URL 
                : `${process.env.WEBHOOK_URL}/webhook` // 添加生命周期通知URL
        };

        console.log('Creating new subscription with payload:', JSON.stringify(subscription, null, 2));

        try {
            console.log('Creating subscription...');
            const result = await client
                .api('/subscriptions')
                .header('Accept', 'application/json')
                .header('Content-Type', 'application/json')
                .post(subscription);

            console.log('Subscription created successfully:', JSON.stringify(result, null, 2));

            // 验证订阅是否真的创建成功
            const newSubscription = await client
                .api(`/subscriptions/${result.id}`)
                .get();

            console.log('Verified subscription status:', JSON.stringify(newSubscription, null, 2));

            res.json({ 
                success: true, 
                subscription: result,
                status: newSubscription.status,
                details: {
                    id: result.id,
                    expirationDateTime: result.expirationDateTime,
                    resource: result.resource,
                    status: newSubscription.status
                }
            });
        } catch (subscriptionError) {
            console.error('Subscription creation error:', {
                code: subscriptionError.code,
                statusCode: subscriptionError.statusCode,
                message: subscriptionError.message,
                body: subscriptionError.body
            });
            throw subscriptionError;
        }
    } catch (error) {
        console.error('Error in subscription process:', error);
        res.status(500).json({ 
            error: '创建邮件订阅失败',
            details: {
                code: error.code,
                message: error.message
            }
        });
    }
});

app.post('/subscriptions/teams', async (req, res) => {
    try {
        const sessionId = req.cookies.sessionId;
        const session = sessions.get(sessionId);
        
        if (!session || session.expiresAt <= Date.now()) {
            return res.status(401).json({ error: '未登录或会话已过期' });
        }

        // 验证必要的环境变量
        if (!process.env.WEBHOOK_URL) {
            console.error('Missing WEBHOOK_URL environment variable');
            return res.status(500).json({ error: '服务器配置错误：缺少 WEBHOOK_URL' });
        }

        if (!process.env.SUBSCRIPTION_SECRET) {
            console.error('Missing SUBSCRIPTION_SECRET environment variable');
            return res.status(500).json({ error: '服务器配置错误：缺少 SUBSCRIPTION_SECRET' });
        }

        console.log('Creating teams subscription with config:', {
            webhookUrl: process.env.WEBHOOK_URL,
            subscriptionSecret: process.env.SUBSCRIPTION_SECRET.substring(0, 4) + '...', // 只显示前4个字符
            accessToken: session.accessToken ? 'Present' : 'Missing'
        });

        const client = Client.init({
            authProvider: (done) => {
                done(null, session.accessToken);
            }
        });

        // 先检查现有订阅
        console.log('Checking existing subscriptions...');
        const existingSubscriptions = await client
            .api('/subscriptions')
            .get();
        
        console.log('Existing subscriptions:', JSON.stringify(existingSubscriptions, null, 2));

        // 删除任何现有的Teams订阅
        for (const sub of existingSubscriptions.value || []) {
            if (sub.resource.includes('chats')) {
                console.log('Deleting existing subscription:', sub.id);
                await client
                    .api(`/subscriptions/${sub.id}`)
                    .delete();
            }
        }

        // 方案1: 设置短期过期时间（1小时内）
        const expirationDateTime = new Date(Date.now() + 60 * 60 * 1000); // 1小时后过期
        
        const subscription = {
            changeType: 'created,updated',
            notificationUrl: process.env.WEBHOOK_URL.endsWith('/webhook') 
                ? process.env.WEBHOOK_URL 
                : `${process.env.WEBHOOK_URL}/webhook`,
            resource: '/me/chats/getAllMessages',
            expirationDateTime: expirationDateTime.toISOString(),
            clientState: process.env.SUBSCRIPTION_SECRET,
            lifecycleNotificationUrl: process.env.WEBHOOK_URL.endsWith('/webhook') 
                ? process.env.WEBHOOK_URL 
                : `${process.env.WEBHOOK_URL}/webhook` // 添加生命周期通知URL
        };

        console.log('创建Teams订阅:', JSON.stringify(subscription, null, 2));
        const result = await client
            .api('/subscriptions')
            .post(subscription);

        console.log('Teams订阅创建成功:', JSON.stringify(result, null, 2));
        res.json({ success: true, subscription: result });
    } catch (error) {
        console.error('Error creating teams subscription:', error);
        res.status(500).json({ error: '创建 Teams 订阅失败', details: error.message });
    }
});

// 删除订阅
app.delete('/subscriptions/:id', async (req, res) => {
    try {
        const sessionId = req.cookies.sessionId;
        const session = sessions.get(sessionId);
        
        if (!session || session.expiresAt <= Date.now()) {
            return res.status(401).json({ error: '未登录或会话已过期' });
        }

        const subscriptionId = req.params.id;
        if (!subscriptionId) {
            return res.status(400).json({ error: '缺少订阅ID' });
        }

        console.log('正在删除订阅:', subscriptionId);
        
        const client = Client.init({
            authProvider: (done) => {
                done(null, session.accessToken);
            }
        });

        await client
            .api(`/subscriptions/${subscriptionId}`)
            .delete();

        console.log('订阅删除成功');
        res.json({ success: true, message: '订阅删除成功' });
    } catch (error) {
        console.error('删除订阅失败:', error);
        res.status(500).json({ error: '删除订阅失败', details: error.message });
    }
});

// 添加一个内存缓存，用于跟踪已处理的通知
const processedNotifications = new Map();

// Webhook处理程序
app.post('/webhook', async (req, res) => {
    console.log('收到webhook通知:', req.body ? JSON.stringify(req.body) : 'No body');
    
    // 验证令牌处理 - 必须首先处理，且直接返回200 OK和validationToken本身
    const validationToken = req.query.validationToken;
    if (validationToken) {
        console.log('收到验证请求，返回验证令牌:', validationToken);
        return res.status(200).header('Content-Type', 'text/plain').send(validationToken);
    }
    
    // 对于普通通知，使用202状态码
    res.status(202).send();
    
    try {
        // 记录webhook请求的完整信息，对调试非常有用
        console.log('[Webhook] 请求头:', JSON.stringify(req.headers, null, 2));
        console.log('[Webhook] 请求体:', req.body ? JSON.stringify(req.body, null, 2) : 'No body');
        
        // 确保req.body存在且有value属性
        if (!req.body || !req.body.value) {
            console.log('[Webhook] 警告: 请求体为空或无value属性');
            return;
        }
        
        const notifications = req.body.value || [];
        const clientState = process.env.SUBSCRIPTION_SECRET;
        
        if (notifications.length === 0) {
            console.log('[Webhook] 警告: 收到空通知数组');
        } else {
            console.log(`[Webhook] 处理 ${notifications.length} 个通知，期望的客户端状态: ${clientState}`);
        }
        
        // 处理每个通知
        for (const notification of notifications) {
            console.log(`[Webhook] 处理通知 ID: ${notification.subscriptionId}, 资源: ${notification.resource}`);
            
            // 检查是否已处理相同的通知
            const notificationKey = `${notification.subscriptionId}-${notification.resource}-${notification.changeType}`;
            const lastProcessed = processedNotifications.get(notificationKey);
            
            if (lastProcessed) {
                const timeSinceLastProcessed = Date.now() - lastProcessed;
                // 如果同一通知在30秒内已处理过，则跳过
                if (timeSinceLastProcessed < 30000) {
                    console.log(`[Webhook] 跳过重复通知，距上次处理时间: ${timeSinceLastProcessed}ms`);
                    continue;
                }
            }
            
            // 记录此通知的处理时间
            processedNotifications.set(notificationKey, Date.now());
            
            // 如果缓存太大，清理旧记录
            if (processedNotifications.size > 100) {
                // 清理超过5分钟的记录
                const cutoffTime = Date.now() - 5 * 60 * 1000;
                for (const [key, time] of processedNotifications.entries()) {
                    if (time < cutoffTime) {
                        processedNotifications.delete(key);
                    }
                }
            }
            
            // 客户端状态验证 - 严格检查并记录
            if (clientState) {
                if (notification.clientState) {
                    if (notification.clientState !== clientState) {
                        console.warn(`[Webhook] 安全警告! 客户端状态验证失败! 收到: ${notification.clientState}, 期望: ${clientState}`);
                        // 可以选择跳过此通知，但现在仍然处理它，只是记录警告
                        console.log('[Webhook] 尽管客户端状态不匹配，仍继续处理通知');
                    } else {
                        console.log('[Webhook] 客户端状态验证成功');
                    }
                } else {
                    console.warn('[Webhook] 通知中缺少客户端状态，这可能表示安全问题');
                }
            }
            
            // 确定通知类型 (邮件或Teams)
            let notificationType = 'unknown';
            const resourcePath = notification.resource || '';
            
            // 首先检查是否包含Teams聊天相关的路径标识
            if (resourcePath.includes('/chats') || resourcePath.includes('chats(')) {
                notificationType = 'teams';
                console.log('[Webhook] 检测到Teams聊天通知');
                
                // 处理Teams通知
                await handleTeamsNotification(notification);
            } 
            // 然后才检查是否为邮件通知
            else if (resourcePath.includes('/messages') || resourcePath.includes('/Messages')) {
                notificationType = 'email';
                console.log('[Webhook] 检测到邮件通知');
                
                // 处理邮件通知 - 使用单独的函数获取更多详情
                await handleEmailNotification(notification);
            } else {
                console.log(`[Webhook] 未知通知类型，资源路径: ${resourcePath}`);
                
                // 对于未知类型，仍然发送基本通知
                // 添加详细时间戳信息
                notification.receivedAt = new Date().toISOString();
                notification.processedAt = new Date().toISOString();
                
                // 构建事件数据以发送到客户端
                const eventData = {
                    type: 'unknown',
                    changeType: notification.changeType || 'unknown',
                    subscriptionId: notification.subscriptionId,
                    resourcePath: resourcePath,
                    receivedAt: notification.receivedAt,
                    data: {
                        resource: resourcePath,
                        changeType: notification.changeType || 'unknown',
                        receivedAt: notification.receivedAt,
                        processedAt: notification.processedAt,
                        message: '收到未知类型的通知',
                        originalNotification: notification
                    }
                };
                
                console.log(`[Webhook] 发送未知类型通知到客户端`);
                sendToAllClients(eventData);
            }
            
            // 对于生命周期事件，记录特殊日志
            if (notification.lifecycleEvent) {
                console.log(`[Webhook] 收到生命周期事件: ${notification.lifecycleEvent}`);
                
                // 如果是重新订阅通知，可以在这里处理订阅更新逻辑
                if (notification.lifecycleEvent === 'reauthorizationRequired') {
                    console.log('[Webhook] 需要重新授权订阅:', notification.subscriptionId);
                    // TODO: 实现订阅重新授权逻辑
                }
            }
        }
    } catch (error) {
        console.error('[Webhook] 处理webhook通知时出错:', error);
    }
});

// 处理邮件通知
async function handleEmailNotification(notification) {
    try {
        console.log('初始化 Graph 客户端处理邮件通知');
        
        // 创建应用程序授权的Graph客户端
        const client = Client.init({
            authProvider: (done) => {
                console.log('调用邮件通知的身份验证提供程序');
                // 使用应用程序凭据而不是用户令牌
                msalApp.acquireTokenByClientCredential({
                    scopes: ['https://graph.microsoft.com/.default']
                }).then(response => {
                    done(null, response.accessToken);
                }).catch(error => {
                    console.error('获取访问令牌失败:', error);
                    done(error, null);
                });
            }
        });

        // 获取详细信息的资源路径
        let resourceId = '';
        let messageId = '';
        
        // 从通知中提取消息ID
        if (notification.resourceData && notification.resourceData.id) {
            messageId = notification.resourceData.id;
            console.log('从resourceData中提取到消息ID:', messageId);
        } else {
            // 尝试从资源路径中提取ID
            const resourcePath = notification.resource || '';
            // 支持多种格式的邮件路径
            const matches = resourcePath.match(/[Mm]essages\/([^\/]+)$/);
            if (matches && matches[1]) {
                messageId = matches[1];
                console.log('从resource路径中提取到消息ID:', messageId);
            }
        }
        
        // 如果找到了消息ID，构建资源路径
        if (messageId) {
            // 从资源路径中提取用户ID
            const resourcePath = notification.resource || '';
            let userId = 'me';
            
            // 尝试从多种可能的路径格式中提取用户ID
            const userMatches = resourcePath.match(/[Uu]sers\/([^\/]+)\//);
            if (userMatches && userMatches[1]) {
                userId = userMatches[1];
                console.log('从resource路径中提取到用户ID:', userId);
            }
            
            resourceId = `/users/${userId}/messages/${messageId}`;
            console.log('构建的邮件资源路径:', resourceId);
        } else if (notification.resourceData && notification.resourceData['@odata.id']) {
            // 使用完整的odata.id路径
            resourceId = notification.resourceData['@odata.id'];
            console.log('使用odata.id作为资源路径:', resourceId);
        } else {
            throw new Error('无法确定邮件资源路径，通知中缺少必要的ID信息');
        }
        
        console.log('获取邮件详情:', resourceId);
        
        // 获取详细邮件信息，明确请求邮件正文内容
        const message = await client
            .api(resourceId)
            .select('id,subject,from,toRecipients,receivedDateTime,bodyPreview,body,importance,hasAttachments')
            .header('Prefer', 'outlook.body-content-type="text"')
            .get();
        
        console.log('成功获取邮件详情，包含body字段:', !!message.body);
        
        // 如果没有获取到body内容，尝试再次获取邮件并明确请求HTML内容
        let bodyContent = '(无内容)';
        let bodyType = 'text';
        
        if (message.body && message.body.content) {
            bodyContent = message.body.content;
            bodyType = message.body.contentType || 'text';
            console.log(`成功获取到邮件正文，内容类型: ${bodyType}, 长度: ${bodyContent.length} 字符`);
        } else {
            console.log('未获取到邮件正文，尝试再次请求...');
            try {
                const messageWithBody = await client
                    .api(resourceId)
                    .select('body')
                    .header('Prefer', 'outlook.body-content-type="html"')
                    .get();
                
                if (messageWithBody.body && messageWithBody.body.content) {
                    bodyContent = messageWithBody.body.content;
                    bodyType = messageWithBody.body.contentType || 'html';
                    console.log(`第二次尝试获取邮件正文成功，内容类型: ${bodyType}, 长度: ${bodyContent.length} 字符`);
                }
            } catch (bodyError) {
                console.error('第二次尝试获取邮件正文失败:', bodyError);
            }
        }
        
        // 提取和格式化关键邮件信息
        const emailData = {
            messageId: message.id,
            subject: message.subject || '(无主题)',
            from: message.from && message.from.emailAddress 
                ? `${message.from.emailAddress.name || ''} <${message.from.emailAddress.address}>` 
                : '未知发件人',
            to: message.toRecipients && message.toRecipients.length > 0 
                ? message.toRecipients.map(r => 
                    `${r.emailAddress.name || ''} <${r.emailAddress.address}>`).join(', ') 
                : '未知收件人',
            receivedDateTime: message.receivedDateTime,
            bodyPreview: message.bodyPreview || '(无预览)',
            bodyContent: bodyContent,
            bodyType: bodyType,
            importance: message.importance || 'normal',
            hasAttachments: message.hasAttachments || false
        };

        console.log('收到新邮件, 主题:', emailData.subject);
        
        // 构建通知数据并发送到客户端
        sendToAllClients({
            type: 'email',
            changeType: notification.changeType || 'created',
            subscriptionId: notification.subscriptionId,
            resourcePath: notification.resource,
            receivedAt: new Date().toISOString(),
            data: emailData
        });
        
        return emailData;
    } catch (error) {
        console.error('处理邮件通知时出错:', error);
        
        // 发送基本通知，指示出现了错误
        sendToAllClients({
            type: 'email',
            changeType: notification.changeType || 'unknown',
            subscriptionId: notification.subscriptionId || 'unknown',
            resourcePath: notification.resource || 'unknown',
            receivedAt: new Date().toISOString(),
            data: {
                subject: '邮件通知 (无法获取详情)',
                from: '未知发件人',
                to: '未知收件人',
                receivedDateTime: new Date().toISOString(),
                bodyPreview: '无法获取邮件详情，请查看服务器日志了解更多信息。',
                error: error.message
            }
        });
        
        return null;
    }
}

// 处理 Teams 通知
async function handleTeamsNotification(notification) {
    try {
        console.log('初始化 Graph 客户端处理 Teams 通知');
        const client = Client.init({
            authProvider: (done) => {
                console.log('调用 Teams 通知的身份验证提供程序');
                // 使用应用程序凭据而不是用户令牌
                msalApp.acquireTokenByClientCredential({
                    scopes: ['https://graph.microsoft.com/.default']
                }).then(response => {
                    done(null, response.accessToken);
                }).catch(error => {
                    console.error('获取访问令牌失败:', error);
                    done(error, null);
                });
            }
        });

        // 确定资源路径
        let resourcePath = '';
        
        // 首先尝试从 resourceData 中获取完整的 odata.id
        if (notification.resourceData && notification.resourceData['@odata.id']) {
            resourcePath = notification.resourceData['@odata.id'];
            console.log('从 resourceData 中获取到完整的 odata.id:', resourcePath);
        } 
        // 如果没有 odata.id，尝试从 resource 字段构建路径
        else if (notification.resource) {
            // 从通知的 resource 字段中提取
            resourcePath = notification.resource;
            
            // 如果仅提供了基本路径，尝试从 resourceData 获取聊天消息ID
            if (notification.resourceData && notification.resourceData.id) {
                // 确保路径格式正确，末尾添加消息ID
                if (!resourcePath.endsWith(notification.resourceData.id)) {
                    // 检查路径是否已以斜杠结尾
                    if (!resourcePath.endsWith('/')) {
                        resourcePath += '/';
                    }
                    resourcePath += notification.resourceData.id;
                }
            }
            
            console.log('从 resource 构建的路径:', resourcePath);
        } else {
            throw new Error('无法确定 Teams 消息路径，通知中缺少必要信息');
        }

        console.log('获取 Teams 消息详情:', resourcePath);
        
        // 获取消息详情
        const message = await client
            .api(resourcePath)
            .get();

        console.log('成功获取 Teams 消息详情:', message.id);
        
        // 提取所需数据
        const teamsData = {
            messageId: message.id,
            content: message.body ? message.body.content : '(无内容)',
            contentType: message.body ? message.body.contentType : 'text',
            from: message.from && message.from.user ? message.from.user.displayName : '未知用户',
            chatId: message.chatId || '',
            createdDateTime: message.createdDateTime || new Date().toISOString(),
            lastModifiedDateTime: message.lastModifiedDateTime
        };

        console.log('收到新的 Teams 消息，来自:', teamsData.from);
        
        // 构建通知数据并发送到客户端
        sendToAllClients({
            type: 'teams',
            changeType: notification.changeType || 'created',
            subscriptionId: notification.subscriptionId,
            resourcePath: notification.resource,
            receivedAt: new Date().toISOString(),
            data: teamsData
        });
        
        return teamsData;
    } catch (error) {
        console.error('处理 Teams 通知时出错:', error);
        
        // 发送基本通知，指示出现了错误
        sendToAllClients({
            type: 'teams',
            changeType: notification.changeType || 'unknown',
            subscriptionId: notification.subscriptionId || 'unknown',
            resourcePath: notification.resource || 'unknown',
            receivedAt: new Date().toISOString(),
            data: {
                from: '未知用户',
                content: '无法获取 Teams 消息详情，请查看服务器日志了解更多信息。',
                createdDateTime: new Date().toISOString(),
                error: error.message
            }
        });
        
        return null;
    }
}

// 添加测试SSE的端点
app.get('/debug/sse-test', (req, res) => {
    console.log('发送测试SSE消息');
    
    // 发送测试邮件消息
    sendToAllClients({
        type: 'email',
        changeType: 'created',
        subscriptionId: 'test-subscription-id',
        resourcePath: '/users/me/messages',
        receivedAt: new Date().toISOString(),
        data: {
            messageId: 'test-message-id-' + Date.now(),
            subject: '测试邮件标题 - ' + new Date().toLocaleString(),
            from: 'Test Sender <test.sender@example.com>',
            to: 'Current User <current.user@example.com>',
            receivedDateTime: new Date().toISOString(),
            bodyPreview: '这是邮件预览内容...',
            bodyContent: `<div>
                <p>尊敬的用户：</p>
                <p>这是一封测试邮件，用于验证webhook通知系统是否正常工作。</p>
                <p>邮件包含以下信息：</p>
                <ul>
                    <li>发件人：Test Sender</li>
                    <li>收件人：Current User</li>
                    <li>时间：${new Date().toLocaleString()}</li>
                </ul>
                <p>如果您能看到这封邮件的完整内容，说明邮件通知系统工作正常！</p>
                <p>此致</p>
                <p>测试团队</p>
            </div>`,
            bodyType: 'html',
            importance: 'normal',
            hasAttachments: true
        }
    });
    
    // 也发送一个Teams消息测试
    setTimeout(() => {
        sendToAllClients({
            type: 'teams',
            changeType: 'created',
            subscriptionId: 'test-teams-subscription-id',
            resourcePath: '/users/me/chats/all',
            receivedAt: new Date().toISOString(),
            data: {
                from: 'Teams Test User',
                content: '这是一条来自Teams的测试消息，发送时间: ' + new Date().toLocaleString(),
                createdDateTime: new Date().toISOString()
            }
        });
    }, 2000); // 2秒后发送Teams测试消息
    
    res.send('测试消息已发送，请查看浏览器控制台和页面上的通知区域');
});

// 启动服务器
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    console.log('Environment variables:', {
        CLIENT_ID: process.env.CLIENT_ID ? 'Set' : 'Not set',
        CLIENT_SECRET: process.env.CLIENT_SECRET ? 'Set' : 'Not set',
        TENANT_ID: process.env.TENANT_ID ? 'Set' : 'Not set',
        WEBHOOK_URL: process.env.WEBHOOK_URL ? 'Set' : 'Not set',
        SUBSCRIPTION_SECRET: process.env.SUBSCRIPTION_SECRET ? 'Set' : 'Not set',
        REDIRECT_URI: process.env.REDIRECT_URI ? 'Set' : 'Not set'
    });
}); 