/**
 * 服务器状态查询插件 - 用于查询服务器运行状态
 * 当接收到以"服务器"或"server"开头的群消息时，返回服务器运行信息
 */
const os = require('os');
const process = require('process');

class ServerInfoPlugin {
    constructor(client) {
        this.client = client;
        this.name = '服务器状态插件';
        this.description = '查询服务器运行状态，输入 服务器 或 server 命令获取信息';
        this.startTime = Date.now();
        
        console.log(`[${this.name}] 插件已加载`);
    }

    /**
     * 插件初始化方法
     */
    async init() {
        console.log(`[${this.name}] 插件初始化完成`);
    }
    
    /**
     * 获取服务器信息
     * @returns {Object} 服务器信息对象
     */
    getServerInfo() {
        try {
            const uptime = Date.now() - this.startTime;
            const osUptime = os.uptime() * 1000; // 转换为毫秒
            
            const memoryUsage = process.memoryUsage();
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            
            const cpuInfo = os.cpus();
            const cpuCount = cpuInfo.length;
            const cpuModel = cpuInfo[0]?.model || '未知';
            
            return {
                success: true,
                system: {
                    platform: os.platform(),
                    release: os.release(),
                    hostname: os.hostname(),
                    arch: os.arch(),
                    totalMem,
                    freeMem,
                    usedMem: totalMem - freeMem,
                    cpuCount,
                    cpuModel
                },
                process: {
                    pid: process.pid,
                    uptime: uptime,
                    osUptime: osUptime,
                    memoryUsage: {
                        rss: memoryUsage.rss,
                        heapTotal: memoryUsage.heapTotal,
                        heapUsed: memoryUsage.heapUsed,
                        external: memoryUsage.external
                    }
                }
            };
        } catch (error) {
            console.error(`[${this.name}] 获取服务器信息失败:`, error);
            return {
                success: false,
                message: `获取服务器信息失败: ${error.message || '未知错误'}`
            };
        }
    }
    
    /**
     * 格式化服务器信息为可读文本
     * @param {Object} serverInfo 服务器信息对象
     * @returns {string} 格式化后的服务器信息文本
     */
    formatServerInfo(serverInfo) {
        if (!serverInfo || !serverInfo.success) {
            return `❌ ${serverInfo.message || '获取服务器信息失败'}`;
        }
        
        const { system, process } = serverInfo;
        
        // 格式化数字为带单位的字符串
        const formatBytes = (bytes) => {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        };
        
        // 格式化时间为可读字符串
        const formatTime = (ms) => {
            const seconds = Math.floor(ms / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            const days = Math.floor(hours / 24);
            
            if (days > 0) return `${days}天 ${hours % 24}小时`;
            if (hours > 0) return `${hours}小时 ${minutes % 60}分钟`;
            if (minutes > 0) return `${minutes}分钟 ${seconds % 60}秒`;
            return `${seconds}秒`;
        };
        
        // 基本信息
        let result = '🖥️ 服务器状态查询结果\n';
        result += '------------------------\n';
        
        // 系统信息
        result += '📍 系统信息\n';
        result += `系统平台: ${system.platform} ${system.release} (${system.arch})\n`;
        result += `主机名: ${system.hostname}\n`;
        result += `CPU: ${system.cpuModel} (${system.cpuCount}核)\n`;
        result += `内存: ${formatBytes(system.usedMem)}/${formatBytes(system.totalMem)} (已用/总计)\n`;
        result += `内存占用: ${((system.usedMem / system.totalMem) * 100).toFixed(2)}%\n`;
        
        // 进程信息
        result += '\n📍 进程信息\n';
        result += `进程ID: ${process.pid}\n`;
        result += `运行时间: ${formatTime(process.uptime)}\n`;
        result += `系统运行: ${formatTime(process.osUptime)}\n`;
        result += `内存占用: ${formatBytes(process.memoryUsage.rss)}\n`;
        result += `堆内存: ${formatBytes(process.memoryUsage.heapUsed)}/${formatBytes(process.memoryUsage.heapTotal)}\n`;
        
        result += '------------------------\n';
        result += '输入"服务器 详细"查看更多信息';
        
        return result;
    }
    
    /**
     * 格式化详细服务器信息
     * @param {Object} serverInfo 服务器信息对象
     * @returns {string} 格式化后的详细服务器信息文本
     */
    formatDetailedServerInfo(serverInfo) {
        if (!serverInfo || !serverInfo.success) {
            return `❌ ${serverInfo.message || '获取服务器信息失败'}`;
        }
        
        // 将完整对象转为格式化的JSON字符串
        let result = '🖥️ 服务器详细信息\n';
        result += '------------------------\n';
        result += '系统信息:\n';
        result += JSON.stringify(serverInfo.system, null, 2) + '\n';
        result += '\n进程信息:\n';
        result += JSON.stringify(serverInfo.process, null, 2) + '\n';
        
        // 环境变量信息太多，只返回一部分关键环境变量
        const env = {
            NODE_ENV: process.env.NODE_ENV || '未设置',
            PATH: process.env.PATH ? '已设置(太长省略)' : '未设置',
            HOME: process.env.HOME || process.env.USERPROFILE || '未设置',
            TEMP: process.env.TEMP || '未设置'
        };
        
        result += '\n环境变量(部分):\n';
        result += JSON.stringify(env, null, 2);
        
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
            
            // 检查消息是否以"服务器"或"server"开头(不区分大小写)
            let isServerCommand = false;
            let isDetailedInfo = false;
            
            if (content.startsWith('服务器') || content.toLowerCase().startsWith('server')) {
                isServerCommand = true;
                
                // 检查是否需要详细信息
                if (content.includes('详细') || content.toLowerCase().includes('detail')) {
                    isDetailedInfo = true;
                }
            }
            
            if (!isServerCommand) {
                return false;
            }
            
            console.log(`[${this.name}] 收到服务器信息查询请求: ${content}`);
            
            // 获取服务器信息
            const serverInfo = this.getServerInfo();
            
            // 格式化响应消息
            let reply = '';
            if (isDetailedInfo) {
                reply = this.formatDetailedServerInfo(serverInfo);
            } else {
                reply = this.formatServerInfo(serverInfo);
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

module.exports = ServerInfoPlugin; 