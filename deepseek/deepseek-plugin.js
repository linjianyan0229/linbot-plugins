const axios = require('axios');
const fs = require('fs');
const path = require('path');

class DeepSeekPlugin {
    constructor(client) {
        this.client = client;
        this.name = 'DeepSeek对话插件';
        this.description = '基于DeepSeek API的智能对话插件，输入ai+内容来对话';
        this.apiKey = 'sk-'; // 需要设置API密钥
        this.apiUrl = 'https://api.deepseek.com/v1/chat/completions';
        this.model = 'deepseek-chat';
        this.temperature = 0.7;
        this.maxTokens = 2000;
        
        // 设置AI身份
        this.systemPrompt = `你是一个名为"小林"的AI助手，具有以下特点：
1. 性格活泼开朗，喜欢用表情符号
2. 回答简洁明了，不超过200字
3. 使用中文交流，偶尔会使用网络用语
4. 对用户友好，乐于帮助解决问题
5. 如果遇到不懂的问题，会诚实地表示不知道
6. 在群聊中会注意保持适当的社交礼仪`;
        
        // 主人配置
        this.masters = ["2259596781"]; // 主人的QQ号列表
        
        // 黑名单配置
        this.blacklistPath = path.join(__dirname, 'blacklist.json');
        this.blacklist = {
            users: [],
            groups: []
        };
        
        // 上下文配置
        this.contextDir = path.join(__dirname, 'contexts');
        this.contextMaxMessages = 10; // 每个用户保存的最大消息数量
        this.contexts = {}; // 内存中的上下文缓存
        
        console.log(`[${this.name}] 插件已加载`);
    }

    /**
     * 插件初始化方法
     */
    async init() {
        // 加载黑名单
        await this.loadBlacklist();
        
        // 确保上下文目录存在
        this.ensureContextDirectory();
        
        console.log(`[${this.name}] 插件初始化完成`);
    }
    
    /**
     * 确保上下文目录存在
     */
    ensureContextDirectory() {
        try {
            if (!fs.existsSync(this.contextDir)) {
                fs.mkdirSync(this.contextDir, { recursive: true });
                console.log(`[${this.name}] 创建上下文目录: ${this.contextDir}`);
            }
        } catch (error) {
            console.error(`[${this.name}] 创建上下文目录失败:`, error);
        }
    }
    
    /**
     * 获取用户上下文文件路径
     * @param {string} userId 用户ID
     * @returns {string} 文件路径
     */
    getUserContextPath(userId) {
        return path.join(this.contextDir, `${userId}.json`);
    }
    
    /**
     * 加载用户上下文
     * @param {string} userId 用户ID
     * @returns {Array} 上下文消息数组
     */
    loadUserContext(userId) {
        // 如果内存中已有缓存，直接返回
        if (this.contexts[userId]) {
            return this.contexts[userId];
        }
        
        const contextPath = this.getUserContextPath(userId);
        try {
            if (fs.existsSync(contextPath)) {
                const data = fs.readFileSync(contextPath, 'utf8');
                this.contexts[userId] = JSON.parse(data);
                console.log(`[${this.name}] 已加载用户 ${userId} 的上下文，共 ${this.contexts[userId].length} 条消息`);
            } else {
                // 创建空上下文
                this.contexts[userId] = [];
            }
        } catch (error) {
            console.error(`[${this.name}] 加载用户 ${userId} 的上下文失败:`, error);
            this.contexts[userId] = [];
        }
        
        return this.contexts[userId];
    }
    
    /**
     * 保存用户上下文
     * @param {string} userId 用户ID
     */
    saveUserContext(userId) {
        if (!this.contexts[userId]) return;
        
        const contextPath = this.getUserContextPath(userId);
        try {
            fs.writeFileSync(contextPath, JSON.stringify(this.contexts[userId], null, 2), 'utf8');
            console.log(`[${this.name}] 已保存用户 ${userId} 的上下文，共 ${this.contexts[userId].length} 条消息`);
        } catch (error) {
            console.error(`[${this.name}] 保存用户 ${userId} 的上下文失败:`, error);
        }
    }
    
    /**
     * 添加消息到用户上下文
     * @param {string} userId 用户ID
     * @param {string} role 角色 (user/assistant)
     * @param {string} content 消息内容
     */
    addMessageToContext(userId, role, content) {
        // 加载用户上下文
        const context = this.loadUserContext(userId);
        
        // 添加新消息
        context.push({
            role,
            content,
            timestamp: Date.now()
        });
        
        // 如果超过最大消息数，移除最早的消息
        if (context.length > this.contextMaxMessages) {
            context.shift();
        }
        
        // 保存更新后的上下文
        this.saveUserContext(userId);
    }
    
    /**
     * 清除用户上下文
     * @param {string} userId 用户ID
     * @returns {boolean} 是否成功清除
     */
    clearUserContext(userId) {
        try {
            // 清除内存中的缓存
            this.contexts[userId] = [];
            
            // 删除文件（如果存在）
            const contextPath = this.getUserContextPath(userId);
            if (fs.existsSync(contextPath)) {
                fs.unlinkSync(contextPath);
            }
            
            console.log(`[${this.name}] 已清除用户 ${userId} 的上下文`);
            return true;
        } catch (error) {
            console.error(`[${this.name}] 清除用户 ${userId} 的上下文失败:`, error);
            return false;
        }
    }
    
    /**
     * 加载黑名单
     */
    async loadBlacklist() {
        try {
            if (fs.existsSync(this.blacklistPath)) {
                const data = fs.readFileSync(this.blacklistPath, 'utf8');
                this.blacklist = JSON.parse(data);
                console.log(`[${this.name}] 黑名单加载成功，包含 ${this.blacklist.users.length} 个用户和 ${this.blacklist.groups.length} 个群组`);
            } else {
                // 创建默认黑名单文件
                await this.saveBlacklist();
                console.log(`[${this.name}] 黑名单文件不存在，已创建默认文件`);
            }
        } catch (error) {
            console.error(`[${this.name}] 加载黑名单失败:`, error);
        }
    }
    
    /**
     * 保存黑名单
     */
    async saveBlacklist() {
        try {
            fs.writeFileSync(this.blacklistPath, JSON.stringify(this.blacklist, null, 2), 'utf8');
            console.log(`[${this.name}] 黑名单保存成功`);
        } catch (error) {
            console.error(`[${this.name}] 保存黑名单失败:`, error);
        }
    }
    
    /**
     * 检查用户是否在黑名单中
     * @param {string} userId 用户ID
     * @returns {boolean} 是否在黑名单中
     */
    isUserBlacklisted(userId) {
        return this.blacklist.users.includes(userId.toString());
    }
    
    /**
     * 检查群组是否在黑名单中
     * @param {string} groupId 群组ID
     * @returns {boolean} 是否在黑名单中
     */
    isGroupBlacklisted(groupId) {
        return this.blacklist.groups.includes(groupId.toString());
    }
    
    /**
     * 检查用户是否是主人
     * @param {string} userId 用户ID
     * @returns {boolean} 是否是主人
     */
    isMaster(userId) {
        return this.masters.includes(userId.toString());
    }
    
    /**
     * 从CQ码中提取用户ID
     * @param {string} cqCode CQ码
     * @returns {string|null} 用户ID或null
     */
    extractUserIdFromCQCode(cqCode) {
        const match = cqCode.match(/\[CQ:at,qq=(\d+)\]/);
        return match ? match[1] : null;
    }

    /**
     * 处理管理命令
     * @param {string} command 命令
     * @param {string} userId 用户ID
     * @param {string} groupId 群组ID
     * @returns {Promise<string>} 处理结果
     */
    async handleAdminCommand(command, userId, groupId) {
        // 只有主人可以执行管理命令
        if (!this.isMaster(userId)) {
            return "你不是我的主人，无权执行此命令~";
        }
        
        const parts = command.split(' ');
        const action = parts[0].toLowerCase();
        
        // 处理ban命令
        if (action === 'ban') {
            const target = parts.slice(1).join(' ').trim();
            
            // 尝试从CQ码中提取用户ID
            let targetId = this.extractUserIdFromCQCode(target);
            if (!targetId) {
                // 如果不是CQ码，则直接使用输入的内容
                targetId = target;
            }
            
            if (!targetId) {
                return "请指定要ban的用户，可以通过艾特或输入QQ号";
            }
            
            // 如果目标ID已经在黑名单中
            if (this.blacklist.users.includes(targetId)) {
                return `用户 ${targetId} 已经在黑名单中了`;
            }
            
            // 添加到黑名单
            this.blacklist.users.push(targetId);
            await this.saveBlacklist();
            return `已将用户 ${targetId} 添加到黑名单`;
        }
        
        // 处理unban命令
        if (action === 'unban') {
            const target = parts.slice(1).join(' ').trim();
            
            // 尝试从CQ码中提取用户ID
            let targetId = this.extractUserIdFromCQCode(target);
            if (!targetId) {
                // 如果不是CQ码，则直接使用输入的内容
                targetId = target;
            }
            
            if (!targetId) {
                return "请指定要解ban的用户，可以通过艾特或输入QQ号";
            }
            
            // 如果目标ID不在黑名单中
            const index = this.blacklist.users.indexOf(targetId);
            if (index === -1) {
                return `用户 ${targetId} 不在黑名单中`;
            }
            
            // 从黑名单移除
            this.blacklist.users.splice(index, 1);
            await this.saveBlacklist();
            return `已将用户 ${targetId} 从黑名单中移除`;
        }
        
        if (action === 'bangroup' && parts.length > 1) {
            const targetId = parts[1].trim();
            
            // 如果目标群组已经在黑名单中
            if (this.blacklist.groups.includes(targetId)) {
                return `群组 ${targetId} 已经在黑名单中了`;
            }
            
            // 添加到黑名单
            this.blacklist.groups.push(targetId);
            await this.saveBlacklist();
            return `已将群组 ${targetId} 添加到黑名单`;
        }
        
        if (action === 'unbangroup' && parts.length > 1) {
            const targetId = parts[1].trim();
            
            // 如果目标群组不在黑名单中
            const index = this.blacklist.groups.indexOf(targetId);
            if (index === -1) {
                return `群组 ${targetId} 不在黑名单中`;
            }
            
            // 从黑名单移除
            this.blacklist.groups.splice(index, 1);
            await this.saveBlacklist();
            return `已将群组 ${targetId} 从黑名单中移除`;
        }
        
        if (action === 'blacklist') {
            return `黑名单用户: ${this.blacklist.users.join(', ') || '无'}\n黑名单群组: ${this.blacklist.groups.join(', ') || '无'}`;
        }
        
        // 处理清除上下文命令
        if (action === 'clear') {
            const targetUser = parts[1] || userId;
            if (this.clearUserContext(targetUser)) {
                return `已清除用户 ${targetUser} 的对话上下文`;
            } else {
                return `清除用户 ${targetUser} 的对话上下文失败`;
            }
        }
        
        return "未知命令，可用命令: ban, unban, bangroup, unbangroup, blacklist, clear";
    }

    /**
     * 调用DeepSeek API
     * @param {string} content 对话内容
     * @param {string} userId 用户ID
     * @returns {Promise<string>} API返回的回复
     */
    async callDeepSeekAPI(content, userId) {
        try {
            // 加载用户上下文
            const userContext = this.loadUserContext(userId);
            
            // 构建消息列表
            const messages = [
                {
                    role: 'system',
                    content: this.systemPrompt
                }
            ];
            
            // 添加历史上下文消息
            userContext.forEach(msg => {
                messages.push({
                    role: msg.role,
                    content: msg.content
                });
            });
            
            // 添加当前用户消息
            messages.push({
                role: 'user',
                content: content
            });
            
            console.log(`[${this.name}] 发送请求到DeepSeek API，包含 ${messages.length} 条消息`);
            
            const response = await axios.post(this.apiUrl, {
                model: this.model,
                messages: messages,
                temperature: this.temperature,
                max_tokens: this.maxTokens
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            const reply = response.data.choices[0].message.content;
            
            // 将用户消息和AI回复添加到上下文
            this.addMessageToContext(userId, 'user', content);
            this.addMessageToContext(userId, 'assistant', reply);
            
            return reply;
        } catch (error) {
            console.error(`[${this.name}] 调用DeepSeek API失败:`, error);
            return '抱歉，AI服务暂时不可用，请稍后再试。';
        }
    }

    /**
     * 处理消息
     * @param {Object} message 消息对象
     * @returns {Promise<boolean>} 是否处理了消息
     */
    async handleMessage(message) {
        try {
            // 只处理群聊消息
            if (message.message_type !== 'group') {
                return false;
            }

            // 获取消息内容和群号
            const content = message.raw_message || message.message;
            const groupId = message.group_id.toString();
            const userId = message.user_id.toString();

            console.log(`[${this.name}] 收到消息: ${content}`);
            
            // 检查是否是管理命令
            if (typeof content === 'string' && content.toLowerCase().startsWith('ai admin')) {
                const adminCommand = content.substring(8).trim();
                const reply = await this.handleAdminCommand(adminCommand, userId, groupId);
                
                await this.client.callApi('send_group_msg', {
                    group_id: groupId,
                    message: reply
                });
                
                return true;
            }
            
            // 处理清除上下文命令
            if (typeof content === 'string' && content.toLowerCase() === 'ai clear') {
                if (this.clearUserContext(userId)) {
                    await this.client.callApi('send_group_msg', {
                        group_id: groupId,
                        message: `[CQ:at,qq=${userId}] 已清除你的对话上下文`
                    });
                } else {
                    await this.client.callApi('send_group_msg', {
                        group_id: groupId,
                        message: `[CQ:at,qq=${userId}] 清除对话上下文失败，请稍后再试`
                    });
                }
                return true;
            }

            // 检查消息是否以"ai"开头(不区分大小写)
            if (typeof content === 'string' && content.toLowerCase().startsWith('ai')) {
                // 检查群组是否在黑名单中
                if (this.isGroupBlacklisted(groupId)) {
                    console.log(`[${this.name}] 群组 ${groupId} 在黑名单中，忽略消息`);
                    return false;
                }
                
                // 检查用户是否在黑名单中
                if (this.isUserBlacklisted(userId)) {
                    console.log(`[${this.name}] 用户 ${userId} 在黑名单中，忽略消息`);
                    await this.client.callApi('send_group_msg', {
                        group_id: groupId,
                        message: `[CQ:at,qq=${userId}] 你已被列入黑名单，无法使用AI功能`
                    });
                    return true;
                }
                
                console.log(`[${this.name}] 收到AI对话请求: ${content}`);
                
                // 提取ai后面的内容
                const query = content.substring(2).trim();
                
                // 组装回复
                let reply = '';
                if (query) {
                    // 调用DeepSeek API (传入用户ID以便使用上下文)
                    reply = await this.callDeepSeekAPI(query, userId);
                } else {
                    reply = '请在ai后面输入要对话的内容';
                }
                
                console.log(`[${this.name}] 准备回复: ${reply}, 群号: ${groupId}`);
                
                // 发送群消息
                try {
                    const result = await this.client.callApi('send_group_msg', {
                        group_id: groupId,
                        message: reply
                    });
                    console.log(`[${this.name}] 发送消息结果:`, result);
                } catch (sendError) {
                    console.error(`[${this.name}] 发送消息失败:`, sendError);
                }
                
                return true; // 表示已处理该消息
            }
            
            return false; // 未处理该消息
        } catch (error) {
            console.error(`[${this.name}] 处理消息出错:`, error);
            return false;
        }
    }
}

module.exports = DeepSeekPlugin; 