document.addEventListener('DOMContentLoaded', () => {
    // DOM 元素
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const createMailSubscriptionBtn = document.getElementById('createMailSubscription');
    const createTeamsSubscriptionBtn = document.getElementById('createTeamsSubscription');
    const listSubscriptionsBtn = document.getElementById('listSubscriptions');
    const subscriptionPanel = document.querySelector('.subscription-panel');
    const subscriptionList = document.getElementById('subscriptionList');
    const loginStatus = document.getElementById('loginStatus');
    const userInfo = document.getElementById('userInfo');
    const userName = userInfo.querySelector('.user-name');
    const userEmail = userInfo.querySelector('.user-email');

    // 标签切换功能
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // 移除所有活动状态
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanes.forEach(p => p.classList.remove('active'));

            // 添加新的活动状态
            btn.classList.add('active');
            const tabId = btn.getAttribute('data-tab');
            document.getElementById(tabId).classList.add('active');
        });
    });

    // 显示状态提示
    function showStatus(message, type = 'info', duration = 3000) {
        const statusToast = document.getElementById('statusToast');
        if (!statusToast) {
            console.error('状态提示元素未找到');
            return;
        }

        statusToast.textContent = message;
        statusToast.style.display = 'block';
        statusToast.className = 'status-toast ' + type;
        
        setTimeout(() => {
            statusToast.style.display = 'none';
        }, duration);
    }

    // 登录功能
    loginBtn.addEventListener('click', async () => {
        console.log('点击登录按钮');
        try {
            console.log('发送登录请求...');
            const response = await fetch('/auth/login', {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            
            console.log('收到服务器响应:', response.status, response.statusText);
            const responseText = await response.text();
            console.log('原始响应内容:', responseText);
            
            let data;
            try {
                data = JSON.parse(responseText);
                console.log('解析后的响应数据:', data);
            } catch (parseError) {
                console.error('解析响应数据失败:', parseError);
                throw new Error('服务器响应格式错误');
            }
            
            if (!response.ok) {
                console.error('服务器返回错误:', data);
                throw new Error(data.details || `获取登录 URL 失败: ${response.status} ${response.statusText}`);
            }
            
            if (data.authUrl) {
                console.log('准备跳转到认证页面:', data.authUrl);
                showStatus('正在跳转到登录页面...', 'info', 2000);
                
                // 直接使用 window.location 进行跳转
                console.log('执行页面跳转...');
                window.location = data.authUrl;
            } else {
                console.error('响应中没有 authUrl:', data);
                throw new Error('未获取到登录 URL');
            }
        } catch (error) {
            console.error('登录失败:', error);
            showStatus('登录失败: ' + error.message, 'error');
        }
    });

    // 注销功能
    logoutBtn.addEventListener('click', async () => {
        try {
            const response = await fetch('/auth/logout', { method: 'POST' });
            if (!response.ok) {
                throw new Error('注销请求失败');
            }
            const data = await response.json();
            
            if (data.success) {
                updateUI(false);
                showStatus('已成功注销', 'success');
            } else {
                throw new Error('注销失败');
            }
        } catch (error) {
            console.error('注销失败:', error);
            showStatus('注销失败: ' + error.message, 'error');
        }
    });

    // 创建邮件订阅
    createMailSubscriptionBtn.addEventListener('click', async () => {
        try {
            const response = await fetch('/subscriptions/mail', { method: 'POST' });
            const data = await response.json();
            
            if (data.success) {
                showStatus('邮件订阅创建成功');
                await listSubscriptions();
            } else {
                showStatus(data.error || '创建失败', 'error');
            }
        } catch (error) {
            showStatus('创建订阅失败', 'error');
        }
    });

    // 创建 Teams 订阅
    createTeamsSubscriptionBtn.addEventListener('click', async () => {
        try {
            const response = await fetch('/subscriptions/teams', { method: 'POST' });
            const data = await response.json();
            
            if (data.success) {
                showStatus('Teams 订阅创建成功');
                await listSubscriptions();
            } else {
                showStatus(data.error || '创建失败', 'error');
            }
        } catch (error) {
            showStatus('创建订阅失败', 'error');
        }
    });

    // 列出所有订阅
    async function listSubscriptions() {
        try {
            const response = await fetch('/subscriptions');
            const data = await response.json();
            
            subscriptionList.innerHTML = '';
            data.value.forEach(sub => {
                const item = document.createElement('div');
                item.className = 'subscription-item';
                item.innerHTML = `
                    <div class="subscription-header">
                        <strong>资源:</strong> ${sub.resource}
                    </div>
                    <div class="subscription-details">
                        <div><strong>订阅ID:</strong> ${sub.id}</div>
                        <div><strong>过期时间:</strong> ${new Date(sub.expirationDateTime).toLocaleString()}</div>
                        <div><strong>状态:</strong> ${sub.status || '活跃'}</div>
                    </div>
                    <div class="subscription-actions">
                        <button class="btn delete-subscription" data-id="${sub.id}">删除订阅</button>
                    </div>
                `;
                subscriptionList.appendChild(item);
                
                // 为新添加的删除按钮添加事件监听器
                const deleteBtn = item.querySelector('.delete-subscription');
                deleteBtn.addEventListener('click', () => deleteSubscription(sub.id));
            });
        } catch (error) {
            console.error('获取订阅列表失败:', error);
            showStatus('获取订阅列表失败', 'error');
        }
    }
    
    // 删除订阅
    async function deleteSubscription(subscriptionId) {
        try {
            if (!confirm(`确定要删除订阅 ${subscriptionId} 吗？`)) {
                return;
            }
            
            showStatus('正在删除订阅...', 'info');
            const response = await fetch(`/subscriptions/${subscriptionId}`, {
                method: 'DELETE'
            });
            const data = await response.json();
            
            if (data.success) {
                showStatus('订阅删除成功', 'success');
                await listSubscriptions(); // 刷新列表
            } else {
                showStatus(data.error || '删除失败', 'error');
            }
        } catch (error) {
            console.error('删除订阅失败:', error);
            showStatus('删除订阅失败', 'error');
        }
    }

    // 查看所有订阅按钮
    listSubscriptionsBtn.addEventListener('click', listSubscriptions);

    // 更新 UI 状态
    function updateUI(isLoggedIn, userInfo = null) {
        loginBtn.style.display = isLoggedIn ? 'none' : 'block';
        logoutBtn.style.display = isLoggedIn ? 'block' : 'none';
        subscriptionPanel.style.display = isLoggedIn ? 'block' : 'none';
        
        if (isLoggedIn && userInfo) {
            document.getElementById('userInfo').style.display = 'flex';
            userName.textContent = userInfo.displayName;
            userEmail.textContent = userInfo.mail || userInfo.userPrincipalName;
        } else {
            document.getElementById('userInfo').style.display = 'none';
        }
    }

    // 检查登录状态
    async function checkLoginStatus() {
        console.log('检查登录状态...');
        try {
            const response = await fetch('/auth/status');
            console.log('登录状态响应:', response);
            if (!response.ok) {
                throw new Error(`服务器响应错误: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            console.log('登录状态数据:', data);
            
            updateUI(data.isLoggedIn, data.userInfo);
            if (data.isLoggedIn) {
                console.log('用户已登录:', data.userInfo);
                showStatus('登录成功', 'success');
                await listSubscriptions();
                // 建立 SSE 连接
                connectEventSource();
            } else {
                console.log('用户未登录');
            }
        } catch (error) {
            console.error('检查登录状态失败:', error);
            showStatus('检查登录状态失败: ' + error.message, 'error');
        }
    }

    // 创建消息卡片
    function createMessageCard(message, type) {
        const card = document.createElement('div');
        card.className = 'message-card new-message';

        let content = '';
        const timeStr = new Date(message.receivedAt || message.receivedDateTime || new Date()).toLocaleString();
        
        if (type === 'email') {
            // 处理邮件消息
            let subject = '无主题';
            let fromAddress = '未知发件人';
            let toRecipients = '未知收件人';
            let bodyContent = '无内容';
            let hasAttachments = false;
            
            // 从不同的数据结构中提取信息
            if (message.subject) subject = message.subject;
            if (message.from) {
                if (typeof message.from === 'string') {
                    fromAddress = message.from;
                } else if (message.from.address) {
                    fromAddress = message.from.address;
                } else if (message.from.emailAddress && message.from.emailAddress.address) {
                    fromAddress = message.from.emailAddress.address;
                    if (message.from.emailAddress.name) {
                        fromAddress = `${message.from.emailAddress.name} <${fromAddress}>`;
                    }
                }
            }
            
            // 获取收件人信息
            if (message.to) {
                toRecipients = message.to;
            } else if (message.toRecipients && Array.isArray(message.toRecipients)) {
                toRecipients = message.toRecipients.map(r => 
                    r.emailAddress ? `${r.emailAddress.name || ''} <${r.emailAddress.address}>` : r
                ).join(', ');
            }
            
            // 获取邮件正文
            if (message.bodyContent) {
                bodyContent = message.bodyContent;
            } else if (message.body && typeof message.body === 'string') {
                bodyContent = message.body;
            } else if (message.body && message.body.content) {
                bodyContent = message.body.content;
            } else if (message.bodyPreview) {
                bodyContent = message.bodyPreview;
            }
            
            // 检查附件
            if (message.hasAttachments) {
                hasAttachments = true;
            }
            
            // 构建内容
            content = `
                <div class="message-header">
                    <strong>新邮件</strong> - ${timeStr}
                    ${hasAttachments ? '<span class="attachment-indicator">📎</span>' : ''}
                </div>
                <div class="message-content">
                    <div class="message-subject"><strong>主题:</strong> ${subject}</div>
                    <div class="message-from"><strong>发件人:</strong> ${fromAddress}</div>
                    <div class="message-to"><strong>收件人:</strong> ${toRecipients}</div>
                    <div class="message-time"><strong>时间:</strong> ${timeStr}</div>
                    <div class="message-body-toggle"><strong>内容:</strong> <button class="btn-toggle">显示/隐藏</button></div>
                    <div class="message-body-content" style="display: none; white-space: pre-wrap;">${sanitizeHtml(bodyContent)}</div>
                </div>
            `;
        } else if (type === 'teams') {
            // 处理Teams消息
            // 从不同的可能的数据结构中提取信息
            let fromUser = '未知用户';
            let messageContent = '无内容';
            let chatId = message.chatId || '未知聊天ID';
            let createdTime = message.createdDateTime || message.receivedAt || new Date().toISOString();
            
            console.log('处理Teams消息数据:', message);
            
            // 尝试从各种可能的数据结构中提取发送者信息
            if (message.from) {
                if (typeof message.from === 'string') {
                    fromUser = message.from;
                } else if (message.from.user && message.from.user.displayName) {
                    fromUser = message.from.user.displayName;
                } else if (message.from.displayName) {
                    fromUser = message.from.displayName;
                }
            }
            
            // 尝试从各种可能的数据结构中提取内容
            if (message.content) {
                messageContent = message.content;
            } else if (message.body && message.body.content) {
                messageContent = message.body.content;
            } else if (typeof message.body === 'string') {
                messageContent = message.body;
            }
            
            content = `
                <div class="message-header">
                    <strong>Teams 消息</strong> - ${timeStr}
                </div>
                <div class="message-content">
                    <div><strong>发送者:</strong> ${fromUser}</div>
                    <div><strong>聊天ID:</strong> ${chatId}</div>
                    <div><strong>时间:</strong> ${new Date(createdTime).toLocaleString()}</div>
                    <div class="message-body-toggle"><strong>内容:</strong> <button class="btn-toggle">显示/隐藏</button></div>
                    <div class="message-body-content" style="display: none; white-space: pre-wrap;">${sanitizeHtml(messageContent)}</div>
                </div>
            `;
        } else {
            // 未知类型的通知
            let resourcePath = message.resource || message.resourcePath || '未知资源路径';
            let changeType = message.changeType || '未知变更类型';
            
            content = `
                <div class="message-header">
                    <strong>未知类型通知</strong>
                </div>
                <div class="message-content">
                    <div><strong>资源:</strong> ${resourcePath}</div>
                    <div><strong>变更类型:</strong> ${changeType}</div>
                    <div><strong>时间:</strong> ${timeStr}</div>
                    <div class="message-body-toggle"><strong>原始数据:</strong> <button class="btn-toggle">显示/隐藏</button></div>
                    <div class="message-body-content" style="display: none;"><pre>${JSON.stringify(message, null, 2)}</pre></div>
                </div>
            `;
        }

        card.innerHTML = content;
        
        // 添加显示/隐藏内容的事件监听器
        const toggleButton = card.querySelector('.btn-toggle');
        if (toggleButton) {
            toggleButton.addEventListener('click', function() {
                const contentDiv = this.parentNode.nextElementSibling;
                if (contentDiv.style.display === 'none') {
                    contentDiv.style.display = 'block';
                    this.textContent = '隐藏';
                } else {
                    contentDiv.style.display = 'none';
                    this.textContent = '显示';
                }
            });
        }
        
        return card;
    }

    // HTML处理函数，根据内容类型处理消息内容
    function sanitizeHtml(html) {
        if (!html) return '';
        
        // 转换HTML标签和特殊字符
        const cleaned = html
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
        
        // 如果内容过长，截断它
        if (cleaned.length > 2000) {
            return cleaned.substring(0, 2000) + '... [内容过长，已截断]';
        }
        
        // 将Teams消息中常见的HTML格式化标记转为可视的样式
        return cleaned
            // 让换行可见
            .replace(/&lt;br\s*\/?&gt;/g, '<br>')
            .replace(/&lt;p&gt;(.*?)&lt;\/p&gt;/g, '<p>$1</p>')
            // 保留简单的格式化
            .replace(/&lt;b&gt;(.*?)&lt;\/b&gt;/g, '<b>$1</b>')
            .replace(/&lt;i&gt;(.*?)&lt;\/i&gt;/g, '<i>$1</i>')
            .replace(/&lt;u&gt;(.*?)&lt;\/u&gt;/g, '<u>$1</u>')
            .replace(/&lt;em&gt;(.*?)&lt;\/em&gt;/g, '<em>$1</em>')
            .replace(/&lt;strong&gt;(.*?)&lt;\/strong&gt;/g, '<strong>$1</strong>');
    }

    // 添加消息到面板
    function addMessage(message, type) {
        console.log(`添加${type}消息到面板:`, message);
        
        // 额外调试信息
        if (type === 'teams') {
            console.log('Teams消息详情:', {
                from: message.from,
                content: message.content,
                body: message.body,
                chatId: message.chatId,
                createdDateTime: message.createdDateTime,
                receivedAt: message.receivedAt
            });
        }
        
        const messagesContainer = document.getElementById('notification-container');
        if (!messagesContainer) {
            console.error('找不到消息容器元素 #notification-container');
            return;
        }
        
        const card = createMessageCard(message, type);
        
        // 添加到容器的开头
        messagesContainer.insertBefore(card, messagesContainer.firstChild);
        
        // 限制显示的消息数量
        if (messagesContainer.children.length > 50) {
            messagesContainer.removeChild(messagesContainer.lastChild);
        }

        // 触发动画
        setTimeout(() => {
            card.classList.remove('new-message');
        }, 100);
    }

    // 连接到事件源
    function connectEventSource() {
        console.log('正在连接到SSE事件源...');
        
        // 关闭旧的连接（如果存在）
        if (window.existingEventSource) {
            console.log('关闭现有的SSE连接');
            window.existingEventSource.close();
        }
        
        const eventSource = new EventSource('/events');
        window.existingEventSource = eventSource;
        
        // 连接建立时的处理
        eventSource.onopen = () => {
            console.log('SSE连接已成功建立');
            showStatus('实时消息连接已建立', 'success');
        };
        
        eventSource.onmessage = (event) => {
            console.log('收到SSE原始消息:', event.data);
            try {
                const data = JSON.parse(event.data);
                console.log('解析后的SSE消息:', data);
                
                if (data.type === 'connected') {
                    console.log('收到SSE初始连接消息');
                    return;
                }
                
                if (data.type === 'email' || data.type === 'teams') {
                    console.log(`收到${data.type}类型的通知:`, data);
                    // 确保我们正确处理消息数据，特别是对于Teams消息
                    if (data.data) {
                        console.log(`提取${data.type}数据:`, data.data);
                        addMessage(data.data, data.type);
                    } else {
                        // 如果没有data字段，尝试直接使用整个消息对象
                        addMessage(data, data.type);
                    }
                    showStatus(`收到新的 ${data.type === 'email' ? '邮件' : 'Teams'} 通知`, 'success');
                } else {
                    console.log('收到未知类型的通知:', data);
                    // 仍然显示未知类型的消息
                    addMessage(data, 'unknown');
                }
            } catch (error) {
                console.error('处理SSE消息失败:', error, '原始消息:', event.data);
            }
        };

        eventSource.onerror = (error) => {
            console.error('SSE连接错误:', error);
            showStatus('实时消息连接丢失，尝试重新连接...', 'error');
            
            // 尝试重新连接
            setTimeout(connectEventSource, 5000);
        };
        
        // 添加一个调试按钮到UI
        const container = document.querySelector('.notification-section');
        if (container && !document.getElementById('debug-sse-btn')) {
            const debugBtn = document.createElement('button');
            debugBtn.id = 'debug-sse-btn';
            debugBtn.className = 'btn secondary';
            debugBtn.style.marginLeft = '10px';
            debugBtn.textContent = '测试通知';
            debugBtn.addEventListener('click', async () => {
                try {
                    const response = await fetch('/debug/sse-test');
                    if (response.ok) {
                        console.log('已触发测试通知');
                        showStatus('测试通知已触发', 'info');
                    } else {
                        console.error('触发测试通知失败:', await response.text());
                        showStatus('触发测试通知失败', 'error');
                    }
                } catch (error) {
                    console.error('请求测试通知时出错:', error);
                    showStatus('请求测试通知时出错', 'error');
                }
            });
            
            const title = container.querySelector('h2');
            if (title) {
                title.parentNode.insertBefore(debugBtn, title.nextSibling);
            } else {
                container.prepend(debugBtn);
            }
        }
    }

    // 初始检查登录状态
    checkLoginStatus();
}); 