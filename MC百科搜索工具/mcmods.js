const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

class DeepSeekPlugin {
    constructor(client) {
        this.client = client;
        this.name = 'DeepSeek对话插件mod';
        this.description = '基于DeepSeek API的智能对话插件，输入mod+内容来对话';
        this.apiKey = 'sk-';
        this.apiUrl = 'https://api.deepseek.com/v1';
        this.model = 'deepseek-chat';
        this.temperature = 0.7;
        this.maxTokens = 2000;
        
        // 上下文存储
        this.contexts = new Map();
        this.maxContext = 5;
        
        // AI身份设置
        this.systemPrompt = `你是一个专业的Minecraft MOD知识助手，请根据提供的资料和对话上下文整合出一个简明扼要的回答，回答必须基于提供的资料，限制在200字以内。不要包含任何链接或网址。`;
        
        // 权限配置
        this.owner = "3806357586";
        this.masters = ["1706877531","2716966189","1708539615","3100942973","1590956414","2059253374","2109186461","2637150798","3135747027","624326154","2323563421","3204618757","2907331904"];
        
        // 文件路径配置
        this.blacklistPath = path.join(__dirname, 'blacklist.json');
        this.modAliasesPath = path.join(__dirname, 'mod_aliases.json');
        this.recipesPath = path.join(__dirname, 'recipes.json');
        this.cachePath = path.join(__dirname, 'mod_cache.json');
        
        // 默认数据
        this.blacklist = { users: [], groups: [] };
        this.modAliases = {
            "ae2": "应用能源二", "jei": "JEI物品管理器", "rei": "REI物品管理器",
            "ic2": "工业时代2", "te": "热力膨胀", "mek": "通用机械",
            "bot": "植物魔法", "thaum": "神秘时代", "tcon": "匠魂", "ae": "应用能源"
        };
        this.recipes = {};
        this.cache = {};
        this.cacheExpiry = 24 * 60 * 60 * 1000;

        console.log(`[${this.name}] 插件已加载`);
    }

    async init() {
        await this.loadData();
        console.log(`[${this.name}] 插件初始化完成`);
    }
    
    async loadData() {
        try {
            // 加载黑名单
            if (fs.existsSync(this.blacklistPath)) {
                this.blacklist = JSON.parse(fs.readFileSync(this.blacklistPath, 'utf8'));
            } else {
                await this.saveData('blacklist');
            }
            
            // 加载MOD别名
            if (fs.existsSync(this.modAliasesPath)) {
                this.modAliases = JSON.parse(fs.readFileSync(this.modAliasesPath, 'utf8'));
            } else {
                await this.saveData('modAliases');
            }
            
            // 加载配方
            if (fs.existsSync(this.recipesPath)) {
                this.recipes = JSON.parse(fs.readFileSync(this.recipesPath, 'utf8'));
            } else {
                await this.saveData('recipes');
            }
            
            // 加载缓存
            if (fs.existsSync(this.cachePath)) {
                this.cache = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
                this.cleanExpiredCache();
            } else {
                await this.saveData('cache');
            }
        } catch (error) {
            console.error(`[${this.name}] 加载数据失败:`, error);
        }
    }
    
    async saveData(type) {
        try {
            const pathMap = {
                blacklist: this.blacklistPath,
                modAliases: this.modAliasesPath,
                recipes: this.recipesPath,
                cache: this.cachePath
            };
            const dataMap = {
                blacklist: this.blacklist,
                modAliases: this.modAliases,
                recipes: this.recipes,
                cache: this.cache
            };
            
            fs.writeFileSync(pathMap[type], JSON.stringify(dataMap[type], null, 2), 'utf8');
            console.log(`[${this.name}] ${type}保存成功`);
        } catch (error) {
            console.error(`[${this.name}] 保存${type}失败:`, error);
        }
    }
    
    cleanExpiredCache() {
        const now = Date.now();
        let expiredCount = 0;
        for (const key in this.cache) {
            if (now - this.cache[key].timestamp > this.cacheExpiry) {
                delete this.cache[key];
                expiredCount++;
            }
        }
        if (expiredCount > 0) {
            console.log(`[${this.name}] 清理了 ${expiredCount} 个过期缓存项`);
            this.saveData('cache');
        }
    }
    
    // 权限检查方法
    isUserBlacklisted(userId) { return this.blacklist.users.includes(userId.toString()); }
    isGroupBlacklisted(groupId) { return this.blacklist.groups.includes(groupId.toString()); }
    isOwner(userId) { return userId.toString() === this.owner; }
    isMaster(userId) { return this.isOwner(userId) || this.masters.includes(userId.toString()); }
    
    extractUserIdFromCQCode(cqCode) {
        const match = cqCode.match(/\[CQ:at,qq=(\d+)\]/);
        return match ? match[1] : null;
    }
    
    // 命令处理
    async handleAdminCommand(command, userId, groupId) {
        if (!this.isMaster(userId)) return "你不是管理员或拥有者，无权执行此命令~";
        
        const parts = command.split(' ');
        const action = parts[0].toLowerCase();
        
        // 帮助命令
        if (action === 'help') return this.getHelpMessage(userId);
        
        // 黑名单管理
        if (action === 'ban') return await this.handleBan(parts.slice(1).join(' ').trim());
        if (action === 'unban') return await this.handleUnban(parts.slice(1).join(' ').trim());
        if (action === 'bangroup' && parts.length > 1) return await this.handleBanGroup(parts[1].trim());
        if (action === 'unbangroup' && parts.length > 1) return await this.handleUnbanGroup(parts[1].trim());
        if (action === 'blacklist') return `黑名单用户: ${this.blacklist.users.join(', ') || '无'}\n黑名单群组: ${this.blacklist.groups.join(', ') || '无'}`;
        
        // 管理员管理（仅拥有者）
        if (action === 'addmaster' && this.isOwner(userId) && parts.length > 1) return this.handleAddMaster(parts[1].trim());
        if (action === 'removemaster' && this.isOwner(userId) && parts.length > 1) return this.handleRemoveMaster(parts[1].trim());
        if (action === 'listmasters') return `当前管理员列表: ${this.masters.join(', ')}`;
        
        // MOD别名管理
        if (action === 'addalias' && parts.length > 2) return await this.handleAddAlias(parts[1].toLowerCase(), parts.slice(2).join(' '));
        if (action === 'removealias' && parts.length > 1) return await this.handleRemoveAlias(parts[1].toLowerCase());
        if (action === 'listaliases') return this.getAliasesList();
        
        // 配方管理
        if (action === 'addrecipe' && parts.length > 2) return await this.handleAddRecipe(parts[1], parts.slice(2).join(' '));
        if (action === 'removerecipe' && parts.length > 1) return await this.handleRemoveRecipe(parts[1]);
        if (action === 'listrecipes') return this.getRecipesList();
        
        // 缓存管理
        if (action === 'clearcache') return await this.handleClearCache();
        
        return "未知命令，请输入 modadmin help 查看可用命令";
    }
    
    // 黑名单处理方法
    async handleBan(target) {
        const targetId = this.extractUserIdFromCQCode(target) || target;
        if (!targetId) return "请指定要ban的用户，可以通过艾特或输入QQ号";
        if (this.blacklist.users.includes(targetId)) return `用户 ${targetId} 已经在黑名单中了`;
        this.blacklist.users.push(targetId);
        await this.saveData('blacklist');
        return `已将用户 ${targetId} 添加到黑名单`;
    }
    
    async handleUnban(target) {
        const targetId = this.extractUserIdFromCQCode(target) || target;
        if (!targetId) return "请指定要解ban的用户，可以通过艾特或输入QQ号";
        const index = this.blacklist.users.indexOf(targetId);
        if (index === -1) return `用户 ${targetId} 不在黑名单中`;
        this.blacklist.users.splice(index, 1);
        await this.saveData('blacklist');
        return `已将用户 ${targetId} 从黑名单中移除`;
    }
    
    async handleBanGroup(targetId) {
        if (this.blacklist.groups.includes(targetId)) return `群组 ${targetId} 已经在黑名单中了`;
        this.blacklist.groups.push(targetId);
        await this.saveData('blacklist');
        return `已将群组 ${targetId} 添加到黑名单`;
    }
    
    async handleUnbanGroup(targetId) {
        const index = this.blacklist.groups.indexOf(targetId);
        if (index === -1) return `群组 ${targetId} 不在黑名单中`;
        this.blacklist.groups.splice(index, 1);
        await this.saveData('blacklist');
        return `已将群组 ${targetId} 从黑名单中移除`;
    }
    
    // 管理员管理方法
    handleAddMaster(targetId) {
        if (this.masters.includes(targetId)) return `用户 ${targetId} 已经是管理员了`;
        this.masters.push(targetId);
        return `已将用户 ${targetId} 添加为管理员`;
    }
    
    handleRemoveMaster(targetId) {
        const index = this.masters.indexOf(targetId);
        if (index === -1) return `用户 ${targetId} 不是管理员`;
        this.masters.splice(index, 1);
        return `已将用户 ${targetId} 从管理员中移除`;
    }
    
    // MOD别名方法
    async handleAddAlias(alias, modName) {
        if (this.modAliases[alias]) return `别名 ${alias} 已经存在，对应MOD: ${this.modAliases[alias]}`;
        this.modAliases[alias] = modName;
        await this.saveData('modAliases');
        return `已添加别名 ${alias} 对应MOD: ${modName}`;
    }
    
    async handleRemoveAlias(alias) {
        if (!this.modAliases[alias]) return `别名 ${alias} 不存在`;
        delete this.modAliases[alias];
        await this.saveData('modAliases');
        return `已移除别名 ${alias}`;
    }
    
    getAliasesList() {
        const aliases = Object.entries(this.modAliases).map(([alias, name]) => `${alias} -> ${name}`).join('\n');
        return `当前MOD别名列表:\n${aliases || '无'}`;
    }
    
    // 配方方法
    async handleAddRecipe(itemName, recipe) {
        this.recipes[itemName] = recipe;
        await this.saveData('recipes');
        return `已添加 ${itemName} 的特殊配方: ${recipe}`;
    }
    
    async handleRemoveRecipe(itemName) {
        if (!this.recipes[itemName]) return `物品 ${itemName} 没有特殊配方`;
        delete this.recipes[itemName];
        await this.saveData('recipes');
        return `已移除 ${itemName} 的特殊配方`;
    }
    
    getRecipesList() {
        const recipes = Object.entries(this.recipes).map(([item, recipe]) => `${item}: ${recipe}`).join('\n');
        return `当前特殊配方列表:\n${recipes || '无'}`;
    }
    
    // 缓存方法
    async handleClearCache() {
        this.cache = {};
        await this.saveData('cache');
        return `已清除所有缓存`;
    }
    
    // 帮助信息
    getHelpMessage(userId) {
        let helpMsg = "=== MOD插件帮助 ===\n普通用户命令:\n";
        helpMsg += "mod <内容> - 查询MOD相关信息\nmods <内容> - 在mcmod.cn搜索MOD信息\nmod help - 显示此帮助信息\n";
        
        if (this.isMaster(userId)) {
            helpMsg += "\n管理员命令:\n";
            helpMsg += "modadmin ban <用户> - 将用户加入黑名单\n";
            helpMsg += "modadmin unban <用户> - 将用户移出黑名单\n";
            helpMsg += "modadmin bangroup <群号> - 将群组加入黑名单\n";
            helpMsg += "modadmin unbangroup <群号> - 将群组移出黑名单\n";
            helpMsg += "modadmin blacklist - 查看黑名单\n";
            helpMsg += "modadmin addalias <别名> <MOD名> - 添加MOD别名\n";
            helpMsg += "modadmin removealias <别名> - 移除MOD别名\n";
            helpMsg += "modadmin listaliases - 列出所有MOD别名\n";
            helpMsg += "modadmin addrecipe <物品名> <配方> - 添加特殊配方\n";
            helpMsg += "modadmin removerecipe <物品名> - 移除特殊配方\n";
            helpMsg += "modadmin listrecipes - 列出所有特殊配方\n";
            helpMsg += "modadmin clearcache - 清除缓存\n";
            
            if (this.isOwner(userId)) {
                helpMsg += "\n拥有者命令:\n";
                helpMsg += "modadmin addmaster <用户> - 添加管理员\n";
                helpMsg += "modadmin removemaster <用户> - 移除管理员\n";
                helpMsg += "modadmin listmasters - 列出所有管理员\n";
            }
        }
        
        return helpMsg;
    }

    // 信息处理核心方法
    extractKeywords(text) {
        const chineseWords = text.match(/[\u4e00-\u9fa5]+/g) || [];
        const englishWords = text.match(/\b[a-zA-Z]+\b/g) || [];
        return [...chineseWords, ...englishWords].filter(word => word.length > 1);
    }

    async searchMcMod(keyword) {
        const cacheKey = `search_${keyword.toLowerCase()}`;
        if (this.cache[cacheKey] && Date.now() - this.cache[cacheKey].timestamp < this.cacheExpiry) {
            return this.cache[cacheKey].data;
        }
        
        try {
            const searchUrl = `https://search.mcmod.cn/s?key=${encodeURIComponent(keyword)}`;
            const response = await axios.get(searchUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
            });
            
            this.cache[cacheKey] = { data: response.data, timestamp: Date.now() };
            await this.saveData('cache');
            
            return response.data;
        } catch (error) {
            console.error(`[${this.name}] 搜索mcmod.cn失败:`, error);
            return null;
        }
    }

    extractMostRelevantResult(html) {
        try {
            const $ = cheerio.load(html);
            const firstResult = $('.result-item').first();
            if (firstResult.length) {
                return {
                    url: `https://www.mcmod.cn${firstResult.find('a').attr('href')}`,
                    title: firstResult.find('.head').text().trim(),
                    description: firstResult.find('.body').text().trim().replace(/\s+/g, ' ')
                };
            }
            return null;
        } catch (error) {
            console.error(`[${this.name}] 解析搜索结果失败:`, error);
            return null;
        }
    }

    async scrapePageContent(url) {
        const cacheKey = `page_${encodeURIComponent(url)}`;
        if (this.cache[cacheKey] && Date.now() - this.cache[cacheKey].timestamp < this.cacheExpiry) {
            return this.cache[cacheKey].data;
        }
        
        try {
            const response = await axios.get(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
            });
            
            const $ = cheerio.load(response.data);
            const mainContent = $('.content-main, article, .wiki-detail, .mod-detail');
            let content = mainContent.length ? mainContent.text() : $('body').text();
            content = content.replace(/\s+/g, ' ').trim().substring(0, 5000);
            
            this.cache[cacheKey] = { data: content, timestamp: Date.now() };
            await this.saveData('cache');
            
            return content;
        } catch (error) {
            console.error(`[${this.name}] 爬取页面内容失败:`, error);
            return null;
        }
    }

    async searchAndScrape(query) {
        // 检查特殊配方
        if (this.recipes[query]) return `特殊配方信息: ${this.recipes[query]}`;
        
        // 检查MOD别名
        const lowerQuery = query.toLowerCase();
        if (this.modAliases[lowerQuery]) query = this.modAliases[lowerQuery];
        
        const keywords = this.extractKeywords(query);
        let referenceContent = '';
        
        for (const keyword of keywords.slice(0, 3)) {
            const searchHtml = await this.searchMcMod(keyword);
            if (!searchHtml) continue;
            
            const result = this.extractMostRelevantResult(searchHtml);
            if (!result) continue;
            
            const content = await this.scrapePageContent(result.url);
            if (content) {
                referenceContent += `关键词 "${keyword}" 的搜索结果:\n标题: ${result.title}\n简介: ${result.description}\n内容: ${content}\n\n`;
            }
        }
        
        return referenceContent || '无相关资料';
    }

    async callDeepSeekAPI(messages) {
        try {
            const response = await axios.post(`${this.apiUrl}/chat/completions`, {
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
            return response.data.choices[0].message.content;
        } catch (error) {
            console.error(`[${this.name}] 调用DeepSeek API失败:`, error);
            return '抱歉，AI服务暂时不可用，请稍后再试。';
        }
    }

    async handleMessage(message) {
        try {
            if (message.message_type !== 'group') return false;

            const content = message.raw_message || message.message;
            const groupId = message.group_id.toString();
            const userId = message.user_id.toString();

            console.log(`[${this.name}] 收到消息: ${content}`);
            
            // 处理管理员命令
            if (typeof content === 'string' && content.toLowerCase().startsWith('modadmin')) {
                const reply = await this.handleAdminCommand(content.substring(8).trim(), userId, groupId);
                await this.client.callApi('send_group_msg', { group_id: groupId, message: reply });
                return true;
            }
            
            // 处理帮助命令
            if (typeof content === 'string' && content.toLowerCase() === 'mod help') {
                await this.client.callApi('send_group_msg', { 
                    group_id: groupId, 
                    message: this.getHelpMessage(userId) 
                });
                return true;
            }
            
            // 处理MOD查询命令
            if (typeof content === 'string' && (content.toLowerCase().startsWith('mod ') || content.toLowerCase().startsWith('mods '))) {
                if (this.isGroupBlacklisted(groupId) || this.isUserBlacklisted(userId)) {
                    console.log(`[${this.name}] 群组或用户被黑名单阻止`);
                    return false;
                }
                
                const isModsCommand = content.toLowerCase().startsWith('mods ');
                const query = content.substring(isModsCommand ? 5 : 4).trim();
                
                if (!query) {
                    await this.client.callApi('send_group_msg', { 
                        group_id: groupId, 
                        message: '请在mod或mods后面输入要查询的内容' 
                    });
                    return true;
                }

                // 处理mods命令（直接搜索）
                if (isModsCommand) {
                    const searchHtml = await this.searchMcMod(query);
                    if (!searchHtml) {
                        await this.client.callApi('send_group_msg', { 
                            group_id: groupId, 
                            message: '搜索失败，请稍后再试' 
                        });
                        return true;
                    }
                    
                    const result = this.extractMostRelevantResult(searchHtml);
                    if (!result) {
                        await this.client.callApi('send_group_msg', { 
                            group_id: groupId, 
                            message: '未找到相关信息' 
                        });
                        return true;
                    }
                    
                    await this.client.callApi('send_group_msg', { 
                        group_id: groupId, 
                        message: `搜索结果:\n标题: ${result.title}\n简介: ${result.description}` 
                    });
                    return true;
                }

                // 处理mod命令（AI回答）
                if (!this.contexts.has(groupId)) this.contexts.set(groupId, []);
                const context = this.contexts.get(groupId);

                context.push({ role: 'user', content: query });
                if (context.length > this.maxContext) context.shift();

                const referenceContent = await this.searchAndScrape(query);
                const messages = [
                    { role: 'system', content: this.systemPrompt },
                    ...context.map(item => ({ role: item.role, content: item.content })),
                    { role: 'user', content: `参考资料：${referenceContent || "无相关资料"}` }
                ];

                const reply = await this.callDeepSeekAPI(messages);
                context.push({ role: 'assistant', content: reply });
                if (context.length > this.maxContext) context.shift();

                await this.client.callApi('send_group_msg', { 
                    group_id: groupId, 
                    message: reply.substring(0, 200) 
                });
                return true;
            }
            
            return false;
        } catch (error) {
            console.error(`[${this.name}] 处理消息出错:`, error);
            return false;
        }
    }
}

module.exports = DeepSeekPlugin;

