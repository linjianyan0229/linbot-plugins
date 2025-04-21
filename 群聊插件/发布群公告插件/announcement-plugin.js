/**
 * 群公告发布插件 - 使用API发布群公告，支持多种API格式
 * 当接收到以"发布公告"开头的群消息时，检查发送者是否为管理员，然后将内容作为公告发布
 */

class AnnouncementPlugin {
    constructor(client) {
        this.client = client;
        this.name = '群公告插件';
        this.description = '允许管理员发布群公告，使用方法: 发布公告 [公告内容]';
        this.command = '发布公告';
        
        // 记录群组API支持情况，避免反复尝试已知不支持的API
        this.unsupportedApis = new Map();
        
        console.log(`[${this.name}] 插件已加载`);
    }

    /**
     * 插件初始化方法
     */
    async init() {
        console.log(`[${this.name}] 插件初始化完成`);
    }

    /**
     * 检查用户是否为管理员
     * @param {number|string} groupId 群号
     * @param {number|string} userId 用户ID
     * @returns {Promise<boolean>} 是否为管理员
     */
    async isAdmin(groupId, userId) {
        try {
            // 获取群成员信息
            const response = await this.client.callApi('get_group_member_info', {
                group_id: parseInt(groupId),
                user_id: parseInt(userId),
                no_cache: true
            });
            
            // 检查是否获取成功
            if (!response || response.status === 'failed') {
                console.error(`[${this.name}] 获取群成员信息失败:`, response);
                return false;
            }
            
            // 检查是否为管理员或群主
            const memberInfo = response.data;
            return memberInfo && (
                memberInfo.role === 'admin' || 
                memberInfo.role === 'owner'
            );
        } catch (error) {
            console.error(`[${this.name}] 检查管理员权限失败:`, error);
            return false;
        }
    }

    /**
     * 检查机器人是否为管理员
     * @param {number|string} groupId 群号
     * @returns {Promise<boolean>} 是否为管理员
     */
    async isBotAdmin(groupId) {
        try {
            // 获取机器人QQ号
            const loginInfoResponse = await this.client.callApi('get_login_info');
            if (!loginInfoResponse || loginInfoResponse.status === 'failed' || !loginInfoResponse.data) {
                console.error(`[${this.name}] 获取登录信息失败:`, loginInfoResponse);
                return false;
            }
            
            const botQQ = loginInfoResponse.data.user_id;
            
            // 获取机器人在群中的身份
            const memberInfoResponse = await this.client.callApi('get_group_member_info', {
                group_id: parseInt(groupId),
                user_id: botQQ,
                no_cache: true
            });
            
            if (!memberInfoResponse || memberInfoResponse.status === 'failed' || !memberInfoResponse.data) {
                console.error(`[${this.name}] 获取机器人群成员信息失败:`, memberInfoResponse);
                return false;
            }
            
            const role = memberInfoResponse.data.role;
            return role === 'admin' || role === 'owner';
            
        } catch (error) {
            console.error(`[${this.name}] A检查机器人权限失败:`, error);
            return false;
        }
    }

    /**
     * 发送群消息
     * @param {number|string} groupId 群ID
     * @param {string} message 消息内容
     * @returns {Promise<boolean>} 是否发送成功
     */
    async sendGroupMessage(groupId, message) {
        try {
            const response = await this.client.callApi('send_group_msg', {
                group_id: parseInt(groupId),
                message: message
            });
            
            return response && response.status !== 'failed';
        } catch (error) {
            console.error(`[${this.name}] 发送群消息失败:`, error);
            return false;
        }
    }

    /**
     * 尝试发送群公告
     * @param {number|string} groupId 群ID
     * @param {string} content 公告内容
     * @returns {Promise<{success: boolean, reason: string}>} 发送结果和原因
     */
    async tryPostGroupAnnouncement(groupId, content) {
        try {
            // 确保参数正确
            if (!groupId || !content) {
                return { 
                    success: false, 
                    reason: "参数无效" 
                };
            }
            
            // 检查群组是否已知不支持公告API
            const groupKey = `${groupId}`;
            if (this.unsupportedApis.has(groupKey)) {
                const apis = this.unsupportedApis.get(groupKey);
                // 如果两种API都不支持，直接返回失败
                if (apis.includes('napcat') && apis.includes('gocq')) {
                    return { 
                        success: false, 
                        reason: "该群不支持公告API" 
                    };
                }
            }
            
            // 检查机器人是否有管理员权限
            const hasBotAdminRight = await this.isBotAdmin(groupId);
            if (!hasBotAdminRight) {
                return { 
                    success: false, 
                    reason: "机器人不是管理员，无法发布公告" 
                };
            }
            
            console.log(`[${this.name}] 尝试通过API发布群公告`);
            
            // 不检查napcat api支持情况
            if (!this.unsupportedApis.has(groupKey) || 
                !this.unsupportedApis.get(groupKey).includes('napcat')) {
                // 尝试使用NapCat API
                try {
                    console.log(`[${this.name}] 尝试使用NapCat API发送公告`);
                    const response = await this.client.callApi('_send_group_notice', {
                        group_id: parseInt(groupId),
                        content: content
                    });
                    
                    if (response && response.status !== 'failed') {
                        console.log(`[${this.name}] NapCat API发送成功:`, response);
                        return { 
                            success: true, 
                            reason: "NapCat API发送成功" 
                        };
                    } else {
                        // 记录错误原因
                        if (response && response.message) {
                            if (response.message.includes('no right')) {
                                return { 
                                    success: false, 
                                    reason: "机器人没有发布公告权限" 
                                };
                            }
                        }
                        
                        // 标记该群组不支持napcat API
                        this.markUnsupportedApi(groupKey, 'napcat');
                    }
                } catch (error) {
                    console.error(`[${this.name}] NapCat API调用失败:`, error);
                    this.markUnsupportedApi(groupKey, 'napcat');
                }
            }
            
            // 不检查gocq api支持情况
            if (!this.unsupportedApis.has(groupKey) || 
                !this.unsupportedApis.get(groupKey).includes('gocq')) {
                // 尝试使用go-cqhttp API
                try {
                    console.log(`[${this.name}] 尝试使用go-cqhttp API发送公告`);
                    const response = await this.client.callApi('send_group_notice', {
                        group_id: parseInt(groupId),
                        content: content
                    });
                    
                    if (response && response.status !== 'failed') {
                        console.log(`[${this.name}] go-cqhttp API发送成功:`, response);
                        return { 
                            success: true, 
                            reason: "go-cqhttp API发送成功" 
                        };
                    } else {
                        // 记录错误原因
                        if (response && response.message) {
                            if (response.message.includes('不支持的Api')) {
                                this.markUnsupportedApi(groupKey, 'gocq');
                            } else if (response.message.includes('no right')) {
                                return { 
                                    success: false, 
                                    reason: "机器人没有发布公告权限" 
                                };
                            }
                        }
                    }
                } catch (error) {
                    console.error(`[${this.name}] go-cqhttp API调用失败:`, error);
                    this.markUnsupportedApi(groupKey, 'gocq');
                }
            }
            
            // 所有API都失败了
            console.log(`[${this.name}] 所有公告API调用失败`);
            return { 
                success: false, 
                reason: "公告API调用失败" 
            };
        } catch (error) {
            console.error(`[${this.name}] 发送公告异常:`, error);
            return { 
                success: false, 
                reason: "发送公告时发生异常" 
            };
        }
    }
    
    /**
     * 标记群组不支持特定API
     * @param {string} groupKey 群组键值
     * @param {string} apiType API类型 (napcat 或 gocq)
     */
    markUnsupportedApi(groupKey, apiType) {
        if (!this.unsupportedApis.has(groupKey)) {
            this.unsupportedApis.set(groupKey, []);
        }
        
        const apis = this.unsupportedApis.get(groupKey);
        if (!apis.includes(apiType)) {
            apis.push(apiType);
            console.log(`[${this.name}] 标记群组 ${groupKey} 不支持 ${apiType} API`);
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

            // 获取消息内容
            const content = message.raw_message || message.message;
            if (!content || typeof content !== 'string') {
                return false;
            }
            
            // 检查消息是否以"发布公告"开头
            if (!content.startsWith(this.command)) {
                return false;
            }

            console.log(`[${this.name}] 收到公告请求: ${content}`);
            
            // 提取基本信息
            const groupId = message.group_id;
            const userId = message.user_id;
            
            // 安全获取用户名
            let userName = '管理员';
            if (message.sender) {
                userName = message.sender.card || message.sender.nickname || '管理员';
            }
            
            // 检查用户是否为管理员
            const isAdmin = await this.isAdmin(groupId, userId);
            if (!isAdmin) {
                // 回复非管理员无权限
                await this.sendGroupMessage(groupId, "抱歉，只有管理员才能发布公告。");
                return true;
            }

            // 提取公告内容（去除命令前缀和前后空格）
            let announcement = content.substring(this.command.length).trim();
            
            // 检查公告内容是否为空
            if (!announcement) {
                await this.sendGroupMessage(groupId, "公告内容不能为空，请按照格式: 发布公告 [公告内容]");
                return true;
            }

            console.log(`[${this.name}] 处理群${groupId}公告: ${announcement}`);
            
            // 首先尝试通过API发布公告
            const result = await this.tryPostGroupAnnouncement(groupId, announcement);
            
            if (result.success) {
                // API发布成功
                await this.sendGroupMessage(groupId, `✅ 公告已发布到群公告栏！`);
                return true;
            }
            
            // 根据失败原因给出不同提示
            let failReason = "";
            if (result.reason === "机器人不是管理员，无法发布公告") {
                failReason = "机器人不是群管理员，无法发布群公告，已通过普通消息发送。";
            } else if (result.reason === "机器人没有发布公告权限") {
                failReason = "机器人没有足够权限发布公告，已通过普通消息发送。";
            } else if (result.reason === "该群不支持公告API") {
                failReason = "该群暂不支持公告API，已通过普通消息发送。";
            } else {
                failReason = "公告API调用失败，已通过普通消息发送。";
            }
            
            // API失败，使用普通消息发送
            console.log(`[${this.name}] 使用普通消息发送公告内容，原因: ${result.reason}`);
            
            // 构建美观的公告消息
            const noticeMsg = `📢 群公告 📢\n\n${announcement}\n\n————————————\n发布者: ${userName}\n发布时间: ${new Date().toLocaleString()}`;
            
            // 发送公告消息
            const sent = await this.sendGroupMessage(groupId, noticeMsg);
            
            // 发送结果提示
            if (sent) {
                await this.sendGroupMessage(groupId, failReason);
            } else {
                await this.sendGroupMessage(groupId, "公告发送失败，请稍后再试。");
            }
            
            return true;
        } catch (error) {
            console.error(`[${this.name}] 处理消息错误:`, error);
            
            // 尝试记录更详细的错误信息
            if (error.stack) {
                console.error(`[${this.name}] 错误堆栈:`, error.stack);
            }
            
            return false;
        }
    }
}

module.exports = AnnouncementPlugin; 