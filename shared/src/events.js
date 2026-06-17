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
    GameEnd: "game:end",
    HostBackToLevelSelect: "host:backToLevelSelect",
    GameContinueToResult: "game:continueToResult",
    RoomReset: "room:reset"
};
export const ServerEvents = {
    RoomState: "room:state",
    PlayerHand: "player:hand",
    RoomError: "room:error",
    TimerSync: "timer:sync",
    GameResult: "game:result",
    GameEnded: "game:ended"
};
//# sourceMappingURL=events.js.map
