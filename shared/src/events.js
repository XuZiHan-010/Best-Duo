export const ClientEvents = {
    PlayerJoin: "player:join",
    PlayerLeave: "player:leave",
    PlayerReady: "player:ready",
    SettingsUpdate: "settings:update",
    GameStart: "game:start",
    HostSelectLevel: "host:selectLevel",
    GameBeginPlacement: "game:beginPlacement",
    ChatSend: "chat:send",
    CardPlace: "card:place",
    HintDecide: "hint:decide",
    GameRetry: "game:retry",
    GameNext: "game:next",
    HostBackToLevelSelect: "host:backToLevelSelect",
    RoomReset: "room:reset"
};
export const ServerEvents = {
    RoomState: "room:state",
    PlayerHand: "player:hand",
    RoomError: "room:error",
    TimerSync: "timer:sync",
    GameResult: "game:result"
};
//# sourceMappingURL=events.js.map