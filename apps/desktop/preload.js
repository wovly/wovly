const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("wovly", {
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (settings) => ipcRenderer.invoke("settings:set", { settings })
  },
  chat: {
    send: (messages) => ipcRenderer.invoke("chat:send", { messages }),
    executeInline: (decomposition, originalMessage) => ipcRenderer.invoke("chat:executeInline", { decomposition, originalMessage }),
    // Subscribe to new messages (from WhatsApp sync)
    onNewMessage: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on("chat:newMessage", handler);
      return () => ipcRenderer.removeListener("chat:newMessage", handler);
    }
  },
  calendar: {
    getEvents: (date) => ipcRenderer.invoke("calendar:getEvents", { date })
  },
  integrations: {
    testGoogle: () => ipcRenderer.invoke("integrations:testGoogle"),
    testSlack: () => ipcRenderer.invoke("integrations:testSlack"),
    testIMessage: () => ipcRenderer.invoke("integrations:testIMessage"),
    testWeather: () => ipcRenderer.invoke("integrations:testWeather"),
    startGoogleOAuth: (clientId, clientSecret) => ipcRenderer.invoke("integrations:startGoogleOAuth", { clientId, clientSecret }),
    checkGoogleAuth: () => ipcRenderer.invoke("integrations:checkGoogleAuth"),
    disconnectGoogle: () => ipcRenderer.invoke("integrations:disconnectGoogle"),
    startSlackTunnel: () => ipcRenderer.invoke("integrations:startSlackTunnel"),
    stopSlackTunnel: () => ipcRenderer.invoke("integrations:stopSlackTunnel"),
    getSlackTunnelUrl: () => ipcRenderer.invoke("integrations:getSlackTunnelUrl"),
    startSlackOAuth: (clientId, clientSecret, tunnelUrl) => ipcRenderer.invoke("integrations:startSlackOAuth", { clientId, clientSecret, tunnelUrl }),
    checkSlackAuth: () => ipcRenderer.invoke("integrations:checkSlackAuth"),
    disconnectSlack: () => ipcRenderer.invoke("integrations:disconnectSlack"),
    setWeatherEnabled: (enabled) => ipcRenderer.invoke("integrations:setWeatherEnabled", { enabled }),
    getWeatherEnabled: () => ipcRenderer.invoke("integrations:getWeatherEnabled"),
    // Playwright Browser Automation
    setPlaywrightEnabled: (enabled) => ipcRenderer.invoke("integrations:setPlaywrightEnabled", { enabled }),
    getPlaywrightEnabled: () => ipcRenderer.invoke("integrations:getPlaywrightEnabled"),
    testPlaywright: () => ipcRenderer.invoke("integrations:testPlaywright"),
    getAvailableBrowsers: () => ipcRenderer.invoke("integrations:getAvailableBrowsers"),
    setPlaywrightBrowser: (browser) => ipcRenderer.invoke("integrations:setPlaywrightBrowser", { browser })
  },
  profile: {
    get: () => ipcRenderer.invoke("profile:get"),
    update: (updates) => ipcRenderer.invoke("profile:update", { updates }),
    needsOnboarding: () => ipcRenderer.invoke("profile:needsOnboarding")
  },
  welcome: {
    generate: () => ipcRenderer.invoke("welcome:generate")
  },
  // Chat Interfaces (WhatsApp, etc.)
  whatsapp: {
    connect: () => ipcRenderer.invoke("whatsapp:connect"),
    disconnect: () => ipcRenderer.invoke("whatsapp:disconnect"),
    getStatus: () => ipcRenderer.invoke("whatsapp:getStatus"),
    checkAuth: () => ipcRenderer.invoke("whatsapp:checkAuth"),
    sendMessage: (recipient, message) => ipcRenderer.invoke("whatsapp:sendMessage", { recipient, message }),
    syncToSelfChat: (message, isFromUser) => ipcRenderer.invoke("whatsapp:syncToSelfChat", { message, isFromUser }),
    isSyncReady: () => ipcRenderer.invoke("whatsapp:isSyncReady"),
    // Subscribe to status updates
    onStatus: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on("whatsapp:status", handler);
      return () => ipcRenderer.removeListener("whatsapp:status", handler);
    }
  },
  // Tasks - autonomous background tasks
  tasks: {
    create: (taskData) => ipcRenderer.invoke("tasks:create", taskData),
    list: () => ipcRenderer.invoke("tasks:list"),
    get: (taskId) => ipcRenderer.invoke("tasks:get", taskId),
    update: (taskId, updates) => ipcRenderer.invoke("tasks:update", { taskId, updates }),
    cancel: (taskId) => ipcRenderer.invoke("tasks:cancel", taskId),
    hide: (taskId) => ipcRenderer.invoke("tasks:hide", taskId),
    getUpdates: () => ipcRenderer.invoke("tasks:getUpdates"),
    getRawMarkdown: (taskId) => ipcRenderer.invoke("tasks:getRawMarkdown", taskId),
    saveRawMarkdown: (taskId, markdown) => ipcRenderer.invoke("tasks:saveRawMarkdown", { taskId, markdown }),
    execute: (taskId) => ipcRenderer.invoke("tasks:execute", taskId),
    // Subscribe to task updates
    onUpdate: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on("task:update", handler);
      return () => ipcRenderer.removeListener("task:update", handler);
    }
  },
  // Skills - procedural knowledge library
  skills: {
    list: () => ipcRenderer.invoke("skills:list"),
    get: (skillId) => ipcRenderer.invoke("skills:get", { skillId }),
    save: (skillId, content) => ipcRenderer.invoke("skills:save", { skillId, content }),
    delete: (skillId) => ipcRenderer.invoke("skills:delete", { skillId }),
    getTemplate: () => ipcRenderer.invoke("skills:getTemplate")
  }
});
