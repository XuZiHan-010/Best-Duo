import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/global.css";
import { RoomView } from "./views/RoomView.js";
import { connect } from "./socket/client.js";
import { useRoomStore } from "./store/useRoomStore.js";

// 从 URL 恢复 nick（刷新/重连场景）
const urlNick = new URLSearchParams(window.location.search).get("nick");
if (urlNick) {
  useRoomStore.getState().setMyNick(urlNick);
}

connect(urlNick ?? undefined);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RoomView />
  </React.StrictMode>
);
