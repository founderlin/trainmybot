# trainmybot

本地原型：配置机器人、查看训练，并在 MuJoCo 场景里放置策略。

A local prototype for configuring robots, reviewing training, and placing policies in a MuJoCo scene.

## 运行 / Run

在 `server/` 中，使用已安装 [MuJoCo](https://github.com/google-deepmind/mujoco) 和 Pillow 的 Python：

From `server/`, with Python that has [MuJoCo](https://github.com/google-deepmind/mujoco) and Pillow:

```sh
cd server
./start.sh
```

打开 http://localhost:8766。

Open http://localhost:8766.

## 分区 / Sections

- **GALLERY** — 机器人与配置。目录里是 Microduck、Beni、Sesame。  
  Bots and configurations. The catalog is Microduck, Beni, and Sesame.
- **ARENA** — 训练任务。  
  Training runs.
- **PLAYYARD** — 选择一台机器人和一个 ONNX 文件，点击地面放置。每个实例只绑定当时的那一个文件。Reset 清空场景。  
  Pick one robot and one ONNX file, then click the floor to place it. Each instance keeps that one file. Reset clears the scene.
- **MASTER** — 账户与额度。  
  Account and credits.

界面中的训练记录是示例数据。本演示不保存 ONNX 文件。PLAYYARD 里 Microduck 播放的是预览动作，不是网络输出。Beni 和 Sesame 保持各自公布的站立姿态。

Training records in the UI are sample data. ONNX files are not stored in this demo. Microduck playback in PLAYYARD is a preview motion, not network output. Beni and Sesame stay in their published standing pose.
