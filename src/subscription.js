// 创建订阅
async function createSubscription(accessToken, userId, notificationType) {
    console.log(`为用户 ${userId} 创建 ${notificationType} 订阅`);
    
    let resource;
    let permissions;
    
    // 根据通知类型设置资源路径和所需权限
    if (notificationType === 'email') {
        resource = `/users/${userId}/messages`;
        permissions = ['Mail.Read'];
    } else if (notificationType === 'teams') {
        // Teams 消息订阅 - 使用chatMessage资源路径
        resource = `/users/${userId}/chats/getAllMessages`;
        permissions = ['Chat.Read', 'Chat.ReadWrite'];
    } else {
        throw new Error(`不支持的通知类型: ${notificationType}`);
    }
    
    // 建立过期时间 - 目前设为3天（最长期限，需要更长需自动续订）
    const expirationDateTime = new Date();
    expirationDateTime.setDate(expirationDateTime.getDate() + 3);
    
    // 创建订阅对象
    const subscription = {
        changeType: 'created,updated',
        notificationUrl: process.env.WEBHOOK_URL.endsWith('/webhook') 
            ? process.env.WEBHOOK_URL 
            : `${process.env.WEBHOOK_URL}/webhook`,
        resource: resource,
        expirationDateTime: expirationDateTime.toISOString(),
        clientState: process.env.SUBSCRIPTION_SECRET,
        includeResourceData: false,  // 默认设为false，如果需要资源数据可以设为true
        lifecycleNotificationUrl: process.env.WEBHOOK_URL.endsWith('/webhook') 
            ? process.env.WEBHOOK_URL 
            : `${process.env.WEBHOOK_URL}/webhook` // 生命周期通知URL（必须，因为过期时间>1小时）
    };
    
    console.log(`创建订阅: ${JSON.stringify(subscription, null, 2)}`);
    
    try {
        // 调用 Graph API 创建订阅
        const url = 'https://graph.microsoft.com/v1.0/subscriptions';
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify(subscription)
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error('创建订阅失败:', errorData);
            
            // 增加详细错误信息日志
            if (errorData.error) {
                console.error('错误代码:', errorData.error.code);
                console.error('错误消息:', errorData.error.message);
                
                // 如果是权限错误，打印权限提示
                if (errorData.error.code === 'Authorization_RequestDenied') {
                    console.error('权限错误: 请确保应用有以下权限:', permissions.join(', '));
                }
                
                // 如果是资源路径错误，提供更多信息
                if (errorData.error.code === 'InvalidResource') {
                    console.error('资源路径无效。请检查资源路径是否正确:', resource);
                    console.error('对于Teams聊天，尝试使用 /chats/getAllMessages 或 /users/{id}/chats/getAllMessages');
                }
            }
            
            throw new Error(`创建订阅失败: ${response.status} ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log('订阅创建成功:', result);
        return result;
    } catch (error) {
        console.error('创建订阅时出错:', error);
        throw error;
    }
} 