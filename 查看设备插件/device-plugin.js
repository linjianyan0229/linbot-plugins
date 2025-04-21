/**
 * 设备信息查询插件 - 用于查询机器人设备信息
 * 当接收到以"设备"或"device"开头的群消息时，返回机器人设备信息
 */
const axios = require('axios');

class DeviceInfoPlugin {
    constructor(client) {
        this.client = client;
        this.name = '设备信息查询插件';
        this.description = '查询机器人设备信息，输入 设备 或 device 命令获取信息';
        this.startTime = Date.now(); // 记录插件加载时间
        
        console.log(`[${this.name}] 插件已加载`);
    }

    /**
     * 插件初始化方法
     */
    async init() {
        console.log(`[${this.name}] 插件初始化完成`);
    }
    
    /**
     * 格式化时间间隔为可读字符串
     * @param {number} ms 毫秒数
     * @returns {string} 格式化后的时间字符串
     */
    formatDuration(ms) {
        if (!ms || isNaN(ms)) return '未知';
        
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        let result = '';
        if (days > 0) result += `${days}天 `;
        if (hours > 0 || days > 0) result += `${hours % 24}小时 `;
        if (minutes > 0 || hours > 0 || days > 0) result += `${minutes % 60}分钟 `;
        result += `${seconds % 60}秒`;
        
        return result;
    }

    /**
     * 获取设备信息
     * @returns {Promise<Object>} 设备信息对象
     */
    async getDeviceInfo() {
        try {
            // 获取登录信息
            const loginInfo = await this.client.callApi('get_login_info', {});
            if (!loginInfo || loginInfo.retcode !== 0 || !loginInfo.data) {
                return { 
                    success: false, 
                    message: '获取登录信息失败' 
                };
            }
            
            // 获取版本信息
            const versionInfo = await this.client.callApi('get_version_info', {});
            
            // 获取状态信息
            const statusInfo = await this.client.callApi('get_status', {});
            
            // 尝试获取更详细的机器人状态
            let clientInfo = null;
            try {
                const clientInfoRes = await this.client.callApi('_get_client_info', {});
                if (clientInfoRes && clientInfoRes.retcode === 0 && clientInfoRes.data) {
                    clientInfo = clientInfoRes.data;
                }
            } catch (e) {
                console.log(`[${this.name}] 获取客户端信息失败 (可忽略): ${e.message}`);
            }
            
            // 合并所有信息
            const deviceInfo = {
                success: true,
                login: loginInfo.data || {},
                version: (versionInfo && versionInfo.data) || {},
                status: (statusInfo && statusInfo.data) || {},
                client: clientInfo || {}
            };
            
            return deviceInfo;
        } catch (error) {
            console.error(`[${this.name}] 获取设备信息失败:`, error);
            return {
                success: false,
                message: `获取设备信息失败: ${error.message || '未知错误'}`
            };
        }
    }
    
    /**
     * 格式化设备信息为可读文本
     * @param {Object} deviceInfo 设备信息对象
     * @returns {string} 格式化后的设备信息文本
     */
    formatDeviceInfo(deviceInfo) {
        if (!deviceInfo || !deviceInfo.success) {
            return `❌ ${deviceInfo.message || '获取设备信息失败'}`;
        }
        
        const { login, version, status, client } = deviceInfo;
        
        // 基本信息
        let result = '📱 设备信息查询结果\n';
        result += '========================\n';
        
        // 登录信息
        result += '📍 账号信息\n';
        result += `QQ号: ${login.user_id || '未知'}\n`;
        result += `昵称: ${login.nickname || '未知'}\n`;
        
        // 版本信息
        result += '\n📍 版本信息\n';
        if (version) {
            result += `应用名称: ${version.app_name || version.impl || '未知'}\n`;
            result += `协议版本: ${version.protocol_version || version.version || '未知'}\n`;
            if (version.app_version) {
                result += `应用版本: ${version.app_version}\n`;
            }
        } else {
            result += '无法获取版本信息\n';
        }
        
        // 客户端信息
        if (client && Object.keys(client).length > 0) {
            result += '\n📍 客户端信息\n';
            if (client.device_name) result += `设备名称: ${client.device_name}\n`;
            if (client.device_kind) result += `设备类型: ${client.device_kind}\n`;
            if (client.login_time) {
                const loginTime = new Date(client.login_time);
                result += `登录时间: ${loginTime.toLocaleString()}\n`;
            }
            
            // NapCat可能有这些额外信息
            if (client.app_type) result += `应用类型: ${client.app_type}\n`;
            if (client.client_type) result += `客户端类型: ${client.client_type}\n`;
        }
        
        // 状态信息
        result += '\n📍 运行状态\n';
        if (status) {
            // 时间信息处理
            let uptime = '未知';
            
            // 使用插件加载时间计算运行时间
            const uptimeMS = Date.now() - this.startTime;
            uptime = this.formatDuration(uptimeMS);
            
            // 状态显示
            const online = status.online !== undefined ? status.online : true; // 默认在线
            result += `在线状态: ${online ? '在线' : '离线'}\n`;
            if (status.good !== undefined) {
                result += `服务状态: ${status.good ? '良好' : '异常'}\n`;
            }
            result += `运行时间: ${uptime}\n`;
            
            // 统计信息
            if (status.stat) {
                const stat = status.stat;
                if (stat.packet_sent !== undefined || stat.packet_received !== undefined) {
                    result += `包收发: ↑${stat.packet_sent || 0} ↓${stat.packet_received || 0}\n`;
                }
                if (stat.message_sent !== undefined || stat.message_received !== undefined) {
                    result += `消息收发: ↑${stat.message_sent || 0} ↓${stat.message_received || 0}\n`;
                }
                if (stat.disconnect_times !== undefined) {
                    result += `丢失连接: ${stat.disconnect_times || 0}次\n`;
                }
                if (stat.lost_times !== undefined) {
                    result += `丢失消息: ${stat.lost_times || 0}条\n`;
                }
            }
        } else {
            result += '无法获取状态信息\n';
        }
        
        result += '========================\n';
        result += '输入"设备 详细"查看更多信息';
        
        return result;
    }
    
    /**
     * 格式化详细设备信息
     * @param {Object} deviceInfo 设备信息对象
     * @returns {string} 格式化后的详细设备信息文本
     */
    formatDetailedDeviceInfo(deviceInfo) {
        if (!deviceInfo || !deviceInfo.success) {
            return `❌ ${deviceInfo.message || '获取设备信息失败'}`;
        }
        
        // 将完整对象转为格式化的JSON字符串
        let result = '📱 设备详细信息\n';
        result += '========================\n';
        result += '登录信息:\n';
        result += JSON.stringify(deviceInfo.login, null, 2) + '\n';
        result += '\n版本信息:\n';
        result += JSON.stringify(deviceInfo.version, null, 2) + '\n';
        result += '\n状态信息:\n';
        result += JSON.stringify(deviceInfo.status, null, 2) + '\n';
        
        if (deviceInfo.client && Object.keys(deviceInfo.client).length > 0) {
            result += '\n客户端信息:\n';
            result += JSON.stringify(deviceInfo.client, null, 2) + '\n';
        }
        
        return result;
    }

    /**
     * 处理消息
     * @param {Object} message 消息对象
     * @returns {Promise<boolean>} 是否处理了消息
     */
    async handleMessage(message) {
        try {
            // 只处理群聊和私聊消息
            if (message.message_type !== 'group' && message.message_type !== 'private') {
                return false;
            }

            // 获取消息内容
            const content = message.raw_message || message.message;
            if (!content || typeof content !== 'string') {
                return false;
            }
            
            // 检查消息是否以"设备"或"device"开头(不区分大小写)
            let isDeviceCommand = false;
            let isDetailedInfo = false;
            
            if (content.toLowerCase().startsWith('设备') || content.toLowerCase().startsWith('device')) {
                isDeviceCommand = true;
                
                // 检查是否需要详细信息
                if (content.includes('详细') || content.toLowerCase().includes('detail')) {
                    isDetailedInfo = true;
                }
            }
            
            if (!isDeviceCommand) {
                return false;
            }
            
            console.log(`[${this.name}] 收到设备信息查询请求: ${content}`);
            
            // 获取设备信息
            const deviceInfo = await this.getDeviceInfo();
            
            // 格式化响应消息
            let reply = '';
            if (isDetailedInfo) {
                reply = this.formatDetailedDeviceInfo(deviceInfo);
            } else {
                reply = this.formatDeviceInfo(deviceInfo);
            }
            
            // 发送响应消息
            if (message.message_type === 'group') {
                await this.client.callApi('send_group_msg', {
                    group_id: message.group_id,
                    message: reply
                });
            } else if (message.message_type === 'private') {
                await this.client.callApi('send_private_msg', {
                    user_id: message.user_id,
                    message: reply
                });
            }
            
            return true; // 表示已处理该消息
            
        } catch (error) {
            console.error(`[${this.name}] 处理消息出错:`, error);
            return false;
        }
    }
}

module.exports = DeviceInfoPlugin; 