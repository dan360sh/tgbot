import * as fs from "fs";

const DATA_FILE = "data.json";

export interface GroupConfig {
  systemPrompt: string;
}

export interface AppData {
  groups: Record<string, GroupConfig>;
  userGroups: Record<string, string>; // userId -> groupName
  defaultGroup: string | null;
  responseMode: "all" | "selected";
  blacklist: string[];
  newcomers: {
    enabled: boolean;
    groupName: string | null;
    knownUsers: string[];
  };
  paused: boolean;
}

const defaultData: AppData = {
  groups: {},
  userGroups: {},
  defaultGroup: null,
  responseMode: "all",
  blacklist: [],
  newcomers: { enabled: false, groupName: null, knownUsers: [] },
  paused: false,
};

let _data: AppData = { ...defaultData };

export function loadStorage(): void {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      _data = { ...defaultData, ...raw };
      if (!_data.newcomers) _data.newcomers = defaultData.newcomers;
    } catch {
      _data = { ...defaultData };
    }
  }
}

function save(): void {
  fs.writeFileSync(DATA_FILE, JSON.stringify(_data, null, 2), "utf-8");
}

export const storage = {
  get: (): AppData => _data,

  // Pause
  setPaused(v: boolean) { _data.paused = v; save(); },

  // Groups
  createGroup(name: string, systemPrompt: string) {
    _data.groups[name] = { systemPrompt };
    save();
  },
  deleteGroup(name: string) {
    delete _data.groups[name];
    if (_data.defaultGroup === name) _data.defaultGroup = null;
    for (const uid of Object.keys(_data.userGroups)) {
      if (_data.userGroups[uid] === name) delete _data.userGroups[uid];
    }
    save();
  },
  setDefaultGroup(name: string) { _data.defaultGroup = name; save(); },

  // Users
  addUserToGroup(userId: string, groupName: string) {
    _data.userGroups[userId] = groupName; save();
  },
  removeUserFromGroup(userId: string) {
    delete _data.userGroups[userId]; save();
  },

  // Mode
  setResponseMode(mode: "all" | "selected") { _data.responseMode = mode; save(); },

  // Blacklist
  addToBlacklist(userId: string) {
    if (!_data.blacklist.includes(userId)) { _data.blacklist.push(userId); save(); }
  },
  removeFromBlacklist(userId: string) {
    _data.blacklist = _data.blacklist.filter((id) => id !== userId); save();
  },

  // Newcomers
  setNewcomers(enabled: boolean, groupName?: string) {
    _data.newcomers.enabled = enabled;
    if (groupName !== undefined) _data.newcomers.groupName = groupName;
    save();
  },
  addKnownUser(userId: string) {
    if (!_data.newcomers.knownUsers.includes(userId)) {
      _data.newcomers.knownUsers.push(userId); save();
    }
  },
  addKnownUsers(userIds: string[]) {
    const newIds = userIds.filter((id) => !_data.newcomers.knownUsers.includes(id));
    if (newIds.length > 0) { _data.newcomers.knownUsers.push(...newIds); save(); }
  },
  isKnownUser: (userId: string) => _data.newcomers.knownUsers.includes(userId),

  // Decision helpers
  shouldRespond(userId: string): boolean {
    if (_data.blacklist.includes(userId)) return false;
    if (_data.userGroups[userId]) return true;
    return _data.responseMode === "all";
  },

  getSystemPromptForUser(userId: string, fallback: string): string {
    const groupName = _data.userGroups[userId];
    if (groupName && _data.groups[groupName]) return _data.groups[groupName].systemPrompt;
    if (_data.defaultGroup && _data.groups[_data.defaultGroup]) {
      return _data.groups[_data.defaultGroup].systemPrompt;
    }
    return fallback;
  },
};
