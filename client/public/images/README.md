# 默认头像

把两张默认头像放在此目录。当前使用的文件名是：

- `avatar1jpg.jpg`
- `avatar2.jpg`

如需更换文件名，同步修改 `server/src/game/seating.ts` 的 `defaultAvatarPaths` 常量。

建议：方形、≥ 256×256。服务端在玩家未上传头像时，从这两张里随机分配一张（保证两位玩家不重复）。

Vite 会把 `client/public/` 下的文件原样发布到站点根目录，因此运行时访问路径为 `/images/avatar1jpg.jpg`、`/images/avatar2.jpg`。

> 如果图片路径不匹配，前端会以「昵称首字母」占位（`Avatar` 组件的 `onError` 回退），不会出现破图。
