/**
 * 群监听插件 - 监听并记录群成员变动事件
 * 监听的事件：
 *   - 主动退群
 *   - 被动退群（被踢）
 *   - 主动加群
 *   - 邀请加群
 *   - 加群申请
 *   - 申请审核（管理员回答.是反则.拒绝 【理由】）
 */

const fs = require('fs');
const path = require('path');

class GroupMonitorPlugin {
    constructor(client) {
        this.client = client;
        this.name = '群成员监听插件';
        this.description = '监听群成员加入、退出等变动事件';
        
        // 数据文件路径
        this.dataFilePath = path.join(__dirname, 'group-monitor-data.json');
        
        // 用于记录加群请求，以便关联请求结果
        this.groupRequests = new Map();
        
        // 按群ID分类存储加群申请列表
        this.pendingRequests = {};
        
        // 清理定时器
        this.cleanTimer = null;
        
        // 统计数据
        this.stats = {
            // 按群ID统计
            groups: {},
            // 全局统计
            global: {
                join: {
                    approve: 0,  // 主动加群
                    invite: 0    // 邀请加群
                },
                leave: {
                    active: 0,   // 主动退群
                    kick: 0      // 被踢出群
                },
                requests: {
                    add: 0,      // 加群申请
                    approved: 0, // 同意申请
                    rejected: 0  // 拒绝申请
                }
            }
        };
        
        console.log(`[${this.name}] 插件已加载`);
    }

    /**
     * 插件初始化方法
     */
    async init() {
        // 加载保存的统计数据
        this.loadStatsData();
        
        // 设置定时器，每小时清理一次过期请求
        this.cleanTimer = setInterval(() => {
            this.cleanExpiredRequests();
        }, 60 * 60 * 1000); // 60分钟 = 3600000毫秒
        
        // 设置自动保存定时器，每10分钟保存一次数据
        this.saveTimer = setInterval(() => {
            this.saveStatsData();
        }, 10 * 60 * 1000); // 10分钟 = 600000毫秒
        
        console.log(`[${this.name}] 插件初始化完成，已设置过期请求清理定时器和数据保存定时器`);
    }
    
    /**
     * 插件卸载方法，用于清理资源
     */
    async destroy() {
        // 保存数据
        this.saveStatsData();
        
        // 清除定时器
        if (this.cleanTimer) {
            clearInterval(this.cleanTimer);
            this.cleanTimer = null;
        }
        
        if (this.saveTimer) {
            clearInterval(this.saveTimer);
            this.saveTimer = null;
        }
        
        console.log(`[${this.name}] 插件已卸载，数据已保存`);
    }
    
    /**
     * 加载统计数据
     */
    loadStatsData() {
        try {
            if (fs.existsSync(this.dataFilePath)) {
                const data = fs.readFileSync(this.dataFilePath, 'utf8');
                const parsedData = JSON.parse(data);
                
                // 更新stats对象
                if (parsedData && parsedData.stats) {
                    this.stats = parsedData.stats;
                    console.log(`[${this.name}] 已从文件加载统计数据`);
                }
                
                // 加载待处理的加群申请列表
                if (parsedData && parsedData.pendingRequests) {
                    this.pendingRequests = parsedData.pendingRequests;
                    console.log(`[${this.name}] 已从文件加载待处理加群申请列表`);
                }
            } else {
                console.log(`[${this.name}] 未找到统计数据文件，将使用默认数据`);
            }
        } catch (error) {
            console.error(`[${this.name}] 加载统计数据出错:`, error);
        }
    }
    
    /**
     * 保存统计数据
     */
    saveStatsData() {
        try {
            // 将数据转换成可序列化的对象
            const serializableData = {
                stats: this.stats,
                pendingRequests: this.pendingRequests
            };
            
            // 序列化并写入文件
            fs.writeFileSync(this.dataFilePath, JSON.stringify(serializableData, null, 2), 'utf8');
            console.log(`[${this.name}] 统计数据已保存到文件`);
        } catch (error) {
            console.error(`[${this.name}] 保存统计数据出错:`, error);
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
     * 获取群成员信息
     * @param {number|string} groupId 群号
     * @param {number|string} userId QQ号
     * @returns {Promise<object|null>} 群成员信息
     */
    async getGroupMemberInfo(groupId, userId) {
        try {
            const response = await this.client.callApi('get_group_member_info', {
                group_id: parseInt(groupId),
                user_id: parseInt(userId),
                no_cache: true
            });
            
            if (response && response.status !== 'failed') {
                return response.data;
            }
            return null;
        } catch (error) {
            console.error(`[${this.name}] 获取群成员信息失败:`, error);
            return null;
        }
    }

    /**
     * 获取群信息
     * @param {number|string} groupId 群号
     * @returns {Promise<object|null>} 群信息
     */
    async getGroupInfo(groupId) {
        try {
            const response = await this.client.callApi('get_group_info', {
                group_id: parseInt(groupId),
                no_cache: true
            });
            
            if (response && response.status !== 'failed') {
                return response.data;
            }
            return null;
        } catch (error) {
            console.error(`[${this.name}] 获取群信息失败:`, error);
            return null;
        }
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
            const memberInfo = await this.getGroupMemberInfo(groupId, userId);
            if (!memberInfo) return false;
            
            // 检查是否为管理员或群主
            return memberInfo.role === 'admin' || memberInfo.role === 'owner';
        } catch (error) {
            console.error(`[${this.name}] 检查管理员权限失败:`, error);
            return false;
        }
    }

    /**
     * 格式化用户信息
     * @param {string|number} userId 用户QQ号
     * @param {string} nickname 用户昵称
     * @param {string} card 群名片，没有则使用昵称
     * @returns {string} 格式化后的用户信息
     */
    formatUserInfo(userId, nickname, card) {
        return `${card || nickname || '未知用户'}(${userId})`;
    }

    /**
     * 处理消息
     * @param {Object} message 消息对象
     * @returns {Promise<boolean>} 是否处理了消息
     */
    async handleMessage(message) {
        try {
            // 添加详细日志，跟踪所有事件
            console.log(`[${this.name}] 收到事件: post_type=${message.post_type}, notice_type=${message.notice_type || '无'}, request_type=${message.request_type || '无'}, sub_type=${message.sub_type || '无'}`);
            
            // 处理通知类型的事件
            if (message.post_type === 'notice') {
                // 处理群成员变动事件
                if (message.notice_type === 'group_increase' || message.notice_type === 'group_decrease') {
                    console.log(`[${this.name}] 检测到群成员变动事件: ${message.notice_type}, ${message.sub_type}, 群号: ${message.group_id}, 用户: ${message.user_id}`);
                    return await this.handleGroupMemberChange(message);
                }
            }
            // 处理请求类型的事件
            else if (message.post_type === 'request') {
                // 处理加群请求
                if (message.request_type === 'group') {
                    console.log(`[${this.name}] 检测到加群请求事件: ${message.sub_type}, 群号: ${message.group_id}, 用户: ${message.user_id}`);
                    return await this.handleGroupRequest(message);
                }
            }
            // 处理管理员对加群申请的回应
            else if (message.post_type === 'message' && message.message_type === 'group') {
                // 检查是否是对加群请求的回应
                const content = message.raw_message || message.message;
                if (typeof content !== 'string') return false;
                
                // 检查是否是管理员回应指令
                if (content.startsWith('.是') || content.startsWith('.否')) {
                    return await this.handleAdminResponse(message, content);
                }
                
                // 检查是否是查看待处理加群申请的命令
                if (content === '.查看申请') {
                    return await this.handleViewRequestsCommand(message);
                }
                
                // 检查是否是查询统计指令
                if (content === '.群统计' || content === '.成员统计') {
                    return await this.handleStatsCommand(message);
                }
                
                // 重置统计数据指令
                if (content === '.重置统计') {
                    return await this.handleResetStatsCommand(message);
                }
                
                // 帮助命令
                if (content === '.群监控' || content === '.群监控帮助') {
                    return await this.handleHelpCommand(message);
                }
                
                // 添加重置插件命令
                if (content === '.重置群监控') {
                    return await this.handleResetPluginCommand(message);
                }
            }
            
            return false; // 不处理其他类型的消息
        } catch (error) {
            console.error(`[${this.name}] 处理消息出错:`, error);
            return false;
        }
    }
    
    /**
     * 处理群成员变动事件
     * @param {Object} message 通知消息对象
     * @returns {Promise<boolean>} 是否成功处理
     */
    async handleGroupMemberChange(message) {
        try {
            const groupId = message.group_id;
            const userId = message.user_id;
            const operatorId = message.operator_id; // 操作者QQ号
            
            // 添加详细日志
            console.log(`[${this.name}] 处理群成员变动事件: ${message.notice_type}/${message.sub_type}, 群号: ${groupId}, 用户: ${userId}, 操作者: ${operatorId || '无'}`);
            
            // 获取用户和群信息
            const memberInfo = await this.getGroupMemberInfo(groupId, userId) || {};
            const groupInfo = await this.getGroupInfo(groupId) || {};
            const groupName = groupInfo.group_name || `群${groupId}`;
            
            // 确保群统计数据存在
            this.ensureGroupStats(groupId);
            console.log(`[${this.name}] 当前群${groupId}统计数据:`, JSON.stringify(this.stats.groups[groupId]));
            
            let noticeMsg = '';
            
            // 处理群成员增加事件
            if (message.notice_type === 'group_increase') {
                const userInfo = this.formatUserInfo(userId, memberInfo.nickname, memberInfo.card);
                
                // 主动加群
                if (message.sub_type === 'approve') {
                    noticeMsg = `📥 用户 ${userInfo} 已加入${groupName}`;
                    console.log(`[${this.name}] 用户${userId}加入群${groupId}`);
                    
                    // 更新统计数据
                    this.stats.global.join.approve++;
                    this.stats.groups[groupId].join.approve++;
                    console.log(`[${this.name}] 更新统计数据: 主动加群+1`);
                    // 保存数据
                    this.saveStatsData();
                } 
                // 邀请加群
                else if (message.sub_type === 'invite') {
                    // 尝试获取邀请者信息
                    let inviterInfo = '管理员';
                    if (operatorId) {
                        const inviter = await this.getGroupMemberInfo(groupId, operatorId) || {};
                        inviterInfo = this.formatUserInfo(operatorId, inviter.nickname, inviter.card);
                    }
                    
                    noticeMsg = `📥 用户 ${userInfo} 受邀请加入${groupName}，邀请者: ${inviterInfo}`;
                    console.log(`[${this.name}] 用户${userId}被邀请加入群${groupId}`);
                    
                    // 更新统计数据
                    this.stats.global.join.invite++;
                    this.stats.groups[groupId].join.invite++;
                    console.log(`[${this.name}] 更新统计数据: 邀请加群+1`);
                    // 保存数据
                    this.saveStatsData();
                }
            } 
            // 处理群成员减少事件
            else if (message.notice_type === 'group_decrease') {
                // 由于用户已经离开群，无法通过正常方式获取名片，只能用userId
                const userInfo = userId;
                
                // 主动退群
                if (message.sub_type === 'leave') {
                    noticeMsg = `📤 用户 ${userInfo} 退出了${groupName}`;
                    console.log(`[${this.name}] 用户${userId}退出群${groupId}`);
                    
                    // 更新统计数据
                    this.stats.global.leave.active++;
                    this.stats.groups[groupId].leave.active++;
                    console.log(`[${this.name}] 更新统计数据: 主动退群+1`);
                    // 保存数据
                    this.saveStatsData();
                } 
                // 被踢出群
                else if (message.sub_type === 'kick') {
                    // 尝试获取操作者信息
                    let kickerInfo = '管理员';
                    if (operatorId) {
                        const kicker = await this.getGroupMemberInfo(groupId, operatorId) || {};
                        kickerInfo = this.formatUserInfo(operatorId, kicker.nickname, kicker.card);
                    }
                    
                    noticeMsg = `⛔ 用户 ${userInfo} 被踢出${groupName}，操作者: ${kickerInfo}`;
                    console.log(`[${this.name}] 用户${userId}被踢出群${groupId}`);
                    
                    // 更新统计数据
                    this.stats.global.leave.kick++;
                    this.stats.groups[groupId].leave.kick++;
                    console.log(`[${this.name}] 更新统计数据: 被踢退群+1`);
                    // 保存数据
                    this.saveStatsData();
                } 
                // 群解散
                else if (message.sub_type === 'kick_me') {
                    noticeMsg = `💢 机器人被踢出群${groupName}`;
                    console.log(`[${this.name}] 机器人被踢出群${groupId}`);
                }
            }
            
            // 如果有通知信息，就发送到群里
            if (noticeMsg) {
                await this.sendGroupMessage(groupId, noticeMsg);
                return true;
            }
            
            return false;
        } catch (error) {
            console.error(`[${this.name}] 处理群成员变动出错:`, error);
            return false;
        }
    }
    
    /**
     * 处理加群请求
     * @param {Object} message 请求消息对象
     * @returns {Promise<boolean>} 是否成功处理
     */
    async handleGroupRequest(message) {
        try {
            const groupId = message.group_id;
            const userId = message.user_id;
            const requestFlag = message.flag; // 请求标识，处理请求时需要
            
            // 添加详细日志
            console.log(`[${this.name}] 处理加群请求: sub_type=${message.sub_type}, 群号: ${groupId}, 用户: ${userId}, flag: ${requestFlag}`);
            
            // 获取群信息
            const groupInfo = await this.getGroupInfo(groupId) || {};
            const groupName = groupInfo.group_name || `群${groupId}`;
            
            // 确保群统计数据存在
            this.ensureGroupStats(groupId);
            
            // 加群请求 
            if (message.sub_type === 'add') {
                const comment = message.comment || '无附加信息';
                
                // 保存请求信息，以便后续处理
                this.groupRequests.set(requestFlag, {
                    groupId,
                    userId,
                    comment,
                    time: Date.now(),
                    flag: requestFlag
                });
                
                // 确保该群的pendingRequests数据结构存在
                if (!this.pendingRequests[groupId]) {
                    this.pendingRequests[groupId] = [];
                }
                
                // 将申请添加到待处理列表
                this.pendingRequests[groupId].push({
                    userId: userId,
                    comment: comment,
                    time: Date.now(),
                    flag: requestFlag
                });
                
                console.log(`[${this.name}] 已保存加群请求信息: ${requestFlag}`);
                
                // 发送加群申请通知
                const noticeMsg = `👤 用户 ${userId} 申请加入${groupName}\n📝 附加信息: ${comment}\n\n管理员可回复:\n.是 [QQ号] - 同意申请\n.否 [QQ号] [拒绝理由] - 拒绝申请\n.是 全部 - 同意所有申请\n.查看申请 - 查看所有待处理申请`;
                await this.sendGroupMessage(groupId, noticeMsg);
                console.log(`[${this.name}] 收到用户${userId}加入群${groupId}的申请`);
                
                // 更新统计数据
                this.stats.global.requests.add++;
                this.stats.groups[groupId].requests.add++;
                console.log(`[${this.name}] 更新统计数据: 加群申请+1`);
                // 保存数据
                this.saveStatsData();
                
                return true;
            } 
            // 被邀请进群
            else if (message.sub_type === 'invite') {
                const inviter = message.user_id; // 邀请人QQ号
                
                // 发送邀请通知
                const noticeMsg = `📨 收到来自用户 ${inviter} 的邀请加入${groupName}`;
                console.log(`[${this.name}] 收到用户${inviter}邀请加入群${groupId}`);
                
                return true;
            }
            
            return false;
        } catch (error) {
            console.error(`[${this.name}] 处理加群请求出错:`, error);
            return false;
        }
    }
    
    /**
     * 处理管理员对加群申请的回应
     * @param {Object} message 消息对象
     * @param {string} content 消息内容
     * @returns {Promise<boolean>} 是否成功处理
     */
    async handleAdminResponse(message, content) {
        try {
            const groupId = message.group_id;
            const userId = message.user_id;
            
            // 检查发送者是否为管理员
            const isUserAdmin = await this.isAdmin(groupId, userId);
            if (!isUserAdmin) {
                console.log(`[${this.name}] 非管理员用户${userId}尝试操作加群请求，已忽略`);
                return false;
            }
            
            // 检查是否有待处理申请
            if (!this.pendingRequests[groupId] || this.pendingRequests[groupId].length === 0) {
                await this.sendGroupMessage(groupId, '⚠️ 当前没有待处理的加群申请');
                return true;
            }
            
            // 判断是同意还是拒绝
            const approve = content.startsWith('.是');
            
            // 提取指令的其余部分
            const params = content.substring(2).trim().split(/\s+/);
            
            // 1. 处理批量同意申请的情况: ".是 全部"
            if (approve && params.length > 0 && params[0] === '全部') {
                return await this.handleBatchApprove(message);
            }
            
            // 2. 处理指定QQ号的申请
            // 提取目标QQ号
            if (params.length === 0 || !params[0]) {
                // 如果没有提供QQ号，处理最近的一条申请
                return await this.handleLatestRequest(message, approve, params.slice(1).join(' '));
            } else {
                // 处理指定QQ号的申请
                const targetQQ = params[0];
                return await this.handleSpecificRequest(message, approve, targetQQ, params.slice(1).join(' '));
            }
        } catch (error) {
            console.error(`[${this.name}] 处理管理员响应出错:`, error);
            await this.sendGroupMessage(message.group_id, '⚠️ 处理加群请求时发生错误');
            return false;
        }
    }
    
    /**
     * 处理最近的一条加群申请
     * @param {Object} message 消息对象
     * @param {boolean} approve 是否同意
     * @param {string} reason 拒绝理由（如果是拒绝）
     * @returns {Promise<boolean>} 是否成功处理
     */
    async handleLatestRequest(message, approve, reason) {
        try {
            const groupId = message.group_id;
            const userId = message.user_id;
            
            // 查找该群最近的一条申请
            const pendingList = this.pendingRequests[groupId] || [];
            if (pendingList.length === 0) {
                await this.sendGroupMessage(groupId, '⚠️ 没有待处理的加群申请');
                return true;
            }
            
            // 按时间排序，找出最新的申请
            pendingList.sort((a, b) => b.time - a.time);
            const latestRequest = pendingList[0];
            
            // 处理请求
            return await this.processRequest(groupId, userId, latestRequest, approve, reason);
        } catch (error) {
            console.error(`[${this.name}] 处理最近加群请求出错:`, error);
            await this.sendGroupMessage(message.group_id, '⚠️ 处理加群请求时发生错误');
            return false;
        }
    }
    
    /**
     * 处理指定QQ号的加群申请
     * @param {Object} message 消息对象
     * @param {boolean} approve 是否同意
     * @param {string} targetQQ 目标QQ号
     * @param {string} reason 拒绝理由（如果是拒绝）
     * @returns {Promise<boolean>} 是否成功处理
     */
    async handleSpecificRequest(message, approve, targetQQ, reason) {
        try {
            const groupId = message.group_id;
            const userId = message.user_id;
            
            // 查找该群中指定QQ号的申请
            const pendingList = this.pendingRequests[groupId] || [];
            const targetRequest = pendingList.find(req => req.userId.toString() === targetQQ);
            
            if (!targetRequest) {
                await this.sendGroupMessage(groupId, `⚠️ 未找到QQ号为 ${targetQQ} 的加群申请`);
                return true;
            }
            
            // 处理请求
            return await this.processRequest(groupId, userId, targetRequest, approve, reason);
        } catch (error) {
            console.error(`[${this.name}] 处理指定QQ加群请求出错:`, error);
            await this.sendGroupMessage(message.group_id, '⚠️ 处理加群请求时发生错误');
            return false;
        }
    }
    
    /**
     * 批量处理所有加群申请（全部同意）
     * @param {Object} message 消息对象
     * @returns {Promise<boolean>} 是否成功处理
     */
    async handleBatchApprove(message) {
        try {
            const groupId = message.group_id;
            const userId = message.user_id;
            
            // 获取该群所有待处理申请
            const pendingList = this.pendingRequests[groupId] || [];
            if (pendingList.length === 0) {
                await this.sendGroupMessage(groupId, '⚠️ 没有待处理的加群申请');
                return true;
            }
            
            // 获取操作者信息
            const adminInfo = await this.getGroupMemberInfo(groupId, userId) || {};
            const adminName = this.formatUserInfo(userId, adminInfo.nickname, adminInfo.card);
            
            // 发送处理开始通知
            await this.sendGroupMessage(groupId, `🔄 正在批量处理 ${pendingList.length} 条加群申请，请稍候...`);
            
            // 成功和失败计数
            let successCount = 0;
            let failCount = 0;
            
            // 依次处理每个请求
            for (const request of pendingList) {
                try {
                    // 调用API处理请求
                    const response = await this.client.callApi('set_group_add_request', {
                        flag: request.flag,
                        sub_type: 'add',
                        approve: true,
                        reason: ''
                    });
                    
                    if (response && response.status !== 'failed') {
                        successCount++;
                        
                        // 更新统计数据
                        this.stats.global.requests.approved++;
                        this.stats.groups[groupId].requests.approved++;
                    } else {
                        failCount++;
                        console.error(`[${this.name}] 批量处理加群请求失败，用户: ${request.userId}, 响应:`, response);
                    }
                } catch (error) {
                    failCount++;
                    console.error(`[${this.name}] 批量处理加群请求出错，用户: ${request.userId}:`, error);
                }
            }
            
            // 保存数据
            this.saveStatsData();
            
            // 清空该群的待处理列表
            this.pendingRequests[groupId] = [];
            
            // 发送处理结果通知
            const resultMsg = `✅ 批量处理加群申请完成\n成功: ${successCount} 条\n失败: ${failCount} 条\n操作者: ${adminName}`;
            await this.sendGroupMessage(groupId, resultMsg);
            
            console.log(`[${this.name}] 管理员${userId}已批量同意群${groupId}的加群申请，成功: ${successCount}, 失败: ${failCount}`);
            return true;
        } catch (error) {
            console.error(`[${this.name}] 批量处理加群请求出错:`, error);
            await this.sendGroupMessage(message.group_id, '⚠️ 批量处理加群请求时发生错误');
            return false;
        }
    }
    
    /**
     * 处理单个加群请求
     * @param {number|string} groupId 群号
     * @param {number|string} operatorId 操作者QQ号
     * @param {Object} request 请求对象
     * @param {boolean} approve 是否同意
     * @param {string} reason 拒绝理由（如果是拒绝）
     * @returns {Promise<boolean>} 是否成功处理
     */
    async processRequest(groupId, operatorId, request, approve, reason) {
        try {
            // 调用API处理请求
            const response = await this.client.callApi('set_group_add_request', {
                flag: request.flag,
                sub_type: 'add',
                approve: approve,
                reason: reason
            });
            
            if (response && response.status !== 'failed') {
                // 获取申请人信息
                const applicantId = request.userId;
                
                // 获取操作者信息
                const adminInfo = await this.getGroupMemberInfo(groupId, operatorId) || {};
                const adminName = this.formatUserInfo(operatorId, adminInfo.nickname, adminInfo.card);
                
                // 发送处理结果通知（仅在拒绝时发送）
                if (!approve) {
                    const resultMsg = `❌ 管理员 ${adminName} 已拒绝用户 ${applicantId} 的加群申请${reason ? `\n📝 拒绝理由: ${reason}` : ''}`;
                    await this.sendGroupMessage(groupId, resultMsg);
                }
                // 同意申请时不发送通知，等待群成员增加事件发送通知
                
                // 更新统计数据
                if (approve) {
                    this.stats.global.requests.approved++;
                    this.stats.groups[groupId].requests.approved++;
                } else {
                    this.stats.global.requests.rejected++;
                    this.stats.groups[groupId].requests.rejected++;
                }
                // 保存数据
                this.saveStatsData();
                
                // 从待处理列表中移除
                this.removePendingRequest(groupId, request.userId);
                
                // 从原始请求Map中移除
                if (request.flag) {
                    this.groupRequests.delete(request.flag);
                }
                
                console.log(`[${this.name}] 管理员${operatorId}已${approve ? '同意' : '拒绝'}用户${applicantId}的加群申请`);
                return true;
            } else {
                // 处理失败
                await this.sendGroupMessage(groupId, `⚠️ 处理用户 ${request.userId} 的加群请求失败，可能是请求已过期`);
                console.error(`[${this.name}] 处理加群请求失败:`, response);
                
                // 从待处理列表中移除已过期的请求
                this.removePendingRequest(groupId, request.userId);
                
                return true;
            }
        } catch (error) {
            console.error(`[${this.name}] 处理单个加群请求出错:`, error);
            await this.sendGroupMessage(groupId, `⚠️ 处理用户 ${request.userId} 的加群请求时发生错误`);
            return false;
        }
    }
    
    /**
     * 从待处理请求列表中移除指定用户的请求
     * @param {number|string} groupId 群号
     * @param {number|string} userId QQ号
     */
    removePendingRequest(groupId, userId) {
        try {
            if (this.pendingRequests[groupId]) {
                const index = this.pendingRequests[groupId].findIndex(req => req.userId.toString() === userId.toString());
                if (index !== -1) {
                    this.pendingRequests[groupId].splice(index, 1);
                }
                
                // 保存数据
                this.saveStatsData();
            }
        } catch (error) {
            console.error(`[${this.name}] 移除待处理请求出错:`, error);
        }
    }
    
    /**
     * 处理查询统计命令
     * @param {Object} message 消息对象
     * @returns {Promise<boolean>} 是否成功处理
     */
    async handleStatsCommand(message) {
        try {
            const groupId = message.group_id;
            const userId = message.user_id;
            
            // 检查发送者是否为管理员
            const isUserAdmin = await this.isAdmin(groupId, userId);
            if (!isUserAdmin) {
                console.log(`[${this.name}] 非管理员用户${userId}尝试查看统计数据，已忽略`);
                return false;
            }
            
            // 确保群统计数据存在
            this.ensureGroupStats(groupId);
            
            // 获取群信息
            const groupInfo = await this.getGroupInfo(groupId) || {};
            const groupName = groupInfo.group_name || `群${groupId}`;
            
            // 构建统计信息
            const stats = this.stats.groups[groupId];
            const global = this.stats.global;
            
            let statsMsg = `📊 群成员变动统计 - ${groupName}\n`;
            statsMsg += `------------------------\n`;
            statsMsg += `🔸 本群数据:\n`;
            statsMsg += `  加群人数: ${stats.join.approve + stats.join.invite} 人\n`;
            statsMsg += `    - 主动加群: ${stats.join.approve} 人\n`;
            statsMsg += `    - 邀请加群: ${stats.join.invite} 人\n`;
            statsMsg += `  退群人数: ${stats.leave.active + stats.leave.kick} 人\n`;
            statsMsg += `    - 主动退群: ${stats.leave.active} 人\n`;
            statsMsg += `    - 被踢出群: ${stats.leave.kick} 人\n`;
            statsMsg += `  加群申请: ${stats.requests.add} 条\n`;
            statsMsg += `    - 已同意: ${stats.requests.approved} 条\n`;
            statsMsg += `    - 已拒绝: ${stats.requests.rejected} 条\n`;
            statsMsg += `  审核率: ${stats.requests.add > 0 ? 
                Math.round(((stats.requests.approved + stats.requests.rejected) / stats.requests.add) * 100) : 0}%\n`;
            
            statsMsg += `\n🔸 全局数据:\n`;
            statsMsg += `  加群人数: ${global.join.approve + global.join.invite} 人\n`;
            statsMsg += `  退群人数: ${global.leave.active + global.leave.kick} 人\n`;
            statsMsg += `  加群申请: ${global.requests.add} 条\n`;
            statsMsg += `    - 已处理: ${global.requests.approved + global.requests.rejected} 条\n`;
            
            // 计算净增人数 (所有加群 - 所有退群)
            const netGrowth = (stats.join.approve + stats.join.invite) - (stats.leave.active + stats.leave.kick);
            statsMsg += `\n📈 净增人数: ${netGrowth > 0 ? '+' : ''}${netGrowth} 人\n`;
            
            // 发送统计信息
            await this.sendGroupMessage(groupId, statsMsg);
            console.log(`[${this.name}] 向群${groupId}发送了成员变动统计数据`);
            
            return true;
        } catch (error) {
            console.error(`[${this.name}] 处理统计命令出错:`, error);
            return false;
        }
    }
    
    /**
     * 处理重置统计命令
     * @param {Object} message 消息对象
     * @returns {Promise<boolean>} 是否成功处理
     */
    async handleResetStatsCommand(message) {
        try {
            const groupId = message.group_id;
            const userId = message.user_id;
            
            // 检查发送者是否为管理员
            const isUserAdmin = await this.isAdmin(groupId, userId);
            if (!isUserAdmin) {
                console.log(`[${this.name}] 非管理员用户${userId}尝试重置统计数据，已忽略`);
                return false;
            }
            
            // 重置该群的统计数据
            this.stats.groups[groupId] = this.createDefaultGroupStats();
            
            // 保存数据
            this.saveStatsData();
            
            // 发送重置成功消息
            await this.sendGroupMessage(groupId, '🔄 群成员变动统计数据已重置');
            console.log(`[${this.name}] 已重置群${groupId}的成员变动统计数据`);
            
            return true;
        } catch (error) {
            console.error(`[${this.name}] 处理重置统计命令出错:`, error);
            return false;
        }
    }
    
    /**
     * 确保群统计数据存在
     * @param {number|string} groupId 群号
     */
    ensureGroupStats(groupId) {
        const strGroupId = String(groupId);
        if (!this.stats.groups[strGroupId]) {
            this.stats.groups[strGroupId] = this.createDefaultGroupStats();
        }
    }
    
    /**
     * 创建默认的群统计数据结构
     * @returns {Object} 默认的群统计数据
     */
    createDefaultGroupStats() {
        return {
            join: {
                approve: 0,  // 主动加群
                invite: 0    // 邀请加群
            },
            leave: {
                active: 0,   // 主动退群
                kick: 0      // 被踢出群
            },
            requests: {
                add: 0,      // 加群申请
                approved: 0, // 同意申请
                rejected: 0  // 拒绝申请
            }
        };
    }
    
    /**
     * 清理过期的加群请求记录
     * 定期清理超过24小时的请求记录
     */
    cleanExpiredRequests() {
        try {
            const now = Date.now();
            const expireTime = 24 * 60 * 60 * 1000; // 24小时
            let cleanCount = 0;
            
            // 清理groupRequests中的过期请求
            for (const [flag, request] of this.groupRequests.entries()) {
                if (now - request.time > expireTime) {
                    this.groupRequests.delete(flag);
                    cleanCount++;
                }
            }
            
            // 清理pendingRequests中的过期请求
            for (const groupId in this.pendingRequests) {
                const requests = this.pendingRequests[groupId];
                const initialLength = requests.length;
                
                // 过滤掉过期的请求
                this.pendingRequests[groupId] = requests.filter(req => {
                    return now - req.time <= expireTime;
                });
                
                // 统计清理的数量
                cleanCount += initialLength - this.pendingRequests[groupId].length;
            }
            
            if (cleanCount > 0) {
                console.log(`[${this.name}] 清理过期的加群请求: 已清理${cleanCount}条记录`);
                // 保存数据
                this.saveStatsData();
            }
        } catch (error) {
            console.error(`[${this.name}] 清理过期请求出错:`, error);
        }
    }

    /**
     * 处理帮助命令
     * @param {Object} message 消息对象
     * @returns {Promise<boolean>} 是否成功处理
     */
    async handleHelpCommand(message) {
        try {
            const groupId = message.group_id;
            
            // 构建帮助信息
            let helpMsg = `📋 群成员监控插件使用帮助\n`;
            helpMsg += `------------------------\n`;
            helpMsg += `本插件可以监控群成员的以下行为：\n`;
            helpMsg += `✅ 主动加群\n`;
            helpMsg += `✅ 邀请加群\n`;
            helpMsg += `✅ 主动退群\n`;
            helpMsg += `✅ 被踢出群\n`;
            helpMsg += `✅ 加群申请\n`;
            helpMsg += `✅ 申请审核\n\n`;
            
            helpMsg += `📊 管理员可用命令：\n`;
            helpMsg += `⭐ .是 - 同意最近一条加群申请\n`;
            helpMsg += `⭐ .是 [QQ号] - 同意指定QQ用户的加群申请\n`;
            helpMsg += `⭐ .是 全部 - 批量同意所有待处理的加群申请\n`;
            helpMsg += `⭐ .否 - 拒绝最近一条加群申请\n`;
            helpMsg += `⭐ .否 [QQ号] [理由] - 拒绝指定QQ用户的加群申请\n`;
            helpMsg += `⭐ .查看申请 - 查看待处理的加群申请列表\n`;
            helpMsg += `⭐ .群统计 - 查看群成员变动统计数据\n`;
            helpMsg += `⭐ .重置统计 - 重置当前群的统计数据\n`;
            helpMsg += `⭐ .重置群监控 - 重置整个插件\n`;
            helpMsg += `⭐ .群监控帮助 - 显示本帮助信息\n`;
            
            // 发送帮助信息
            await this.sendGroupMessage(groupId, helpMsg);
            console.log(`[${this.name}] 向群${groupId}发送了帮助信息`);
            
            return true;
        } catch (error) {
            console.error(`[${this.name}] 处理帮助命令出错:`, error);
            return false;
        }
    }

    /**
     * 处理重置插件命令
     * @param {Object} message 消息对象
     * @returns {Promise<boolean>} 是否成功处理
     */
    async handleResetPluginCommand(message) {
        try {
            const groupId = message.group_id;
            const userId = message.user_id;
            
            // 检查发送者是否为管理员
            const isUserAdmin = await this.isAdmin(groupId, userId);
            if (!isUserAdmin) {
                console.log(`[${this.name}] 非管理员用户${userId}尝试重置插件，已忽略`);
                return false;
            }
            
            // 重置插件状态
            this.stats.global = {
                join: {
                    approve: 0,
                    invite: 0
                },
                leave: {
                    active: 0,
                    kick: 0
                },
                requests: {
                    add: 0,
                    approved: 0,
                    rejected: 0
                }
            };
            this.stats.groups = {};
            this.groupRequests.clear();
            this.pendingRequests = {};
            
            // 保存数据
            this.saveStatsData();
            
            // 重新初始化定时器
            if (this.cleanTimer) {
                clearInterval(this.cleanTimer);
            }
            this.cleanTimer = setInterval(() => {
                this.cleanExpiredRequests();
            }, 60 * 60 * 1000);
            
            // 发送重置成功消息
            await this.sendGroupMessage(groupId, '🔄 群成员监控插件已重置');
            console.log(`[${this.name}] 已重置群成员监控插件`);
            
            return true;
        } catch (error) {
            console.error(`[${this.name}] 处理重置插件命令出错:`, error);
            return false;
        }
    }

    /**
     * 处理查看加群申请命令
     * @param {Object} message 消息对象
     * @returns {Promise<boolean>} 是否成功处理
     */
    async handleViewRequestsCommand(message) {
        try {
            const groupId = message.group_id;
            const userId = message.user_id;
            
            // 检查发送者是否为管理员
            const isUserAdmin = await this.isAdmin(groupId, userId);
            if (!isUserAdmin) {
                console.log(`[${this.name}] 非管理员用户${userId}尝试查看加群申请列表，已忽略`);
                return false;
            }
            
            // 检查是否有待处理的申请
            const pendingList = this.pendingRequests[groupId] || [];
            
            if (pendingList.length === 0) {
                await this.sendGroupMessage(groupId, '📋 当前没有待处理的加群申请');
                return true;
            }
            
            // 获取群信息
            const groupInfo = await this.getGroupInfo(groupId) || {};
            const groupName = groupInfo.group_name || `群${groupId}`;
            
            // 构建申请列表消息
            let listMsg = `📋 ${groupName} 待处理加群申请列表 (${pendingList.length}条):\n`;
            listMsg += `------------------------\n`;
            
            // 按时间排序，最新的申请排在前面
            const sortedList = [...pendingList].sort((a, b) => b.time - a.time);
            
            // 最多显示10条
            const displayList = sortedList.slice(0, 10);
            
            for (let i = 0; i < displayList.length; i++) {
                const req = displayList[i];
                const timeStr = new Date(req.time).toLocaleString();
                listMsg += `${i+1}. QQ: ${req.userId}\n`;
                listMsg += `   申请时间: ${timeStr}\n`;
                listMsg += `   附加信息: ${req.comment}\n`;
                if (i < displayList.length - 1) {
                    listMsg += `------------------------\n`;
                }
            }
            
            if (sortedList.length > 10) {
                listMsg += `\n※ 仅显示最近10条申请，共有${sortedList.length}条待处理`;
            }
            
            listMsg += `\n\n处理命令:\n.是 QQ号 - 同意指定QQ的申请\n.否 QQ号 [拒绝理由] - 拒绝指定QQ的申请\n.是 全部 - 同意所有申请`;
            
            // 发送申请列表
            await this.sendGroupMessage(groupId, listMsg);
            console.log(`[${this.name}] 已向群${groupId}发送待处理加群申请列表`);
            
            return true;
        } catch (error) {
            console.error(`[${this.name}] 处理查看加群申请列表命令出错:`, error);
            return false;
        }
    }
}

module.exports = GroupMonitorPlugin;
