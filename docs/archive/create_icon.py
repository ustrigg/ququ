from PIL import Image, ImageDraw

# 创建一个 64x64 的透明背景图像（足够大以保证清晰度）
size = 64
img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# 颜色定义 - 使用深蓝色
mic_color = (70, 130, 180, 255)  # Steel blue
stand_color = (60, 60, 60, 255)   # Dark gray

# 麦克风头部（圆角矩形）
mic_width = 20
mic_height = 28
mic_x = (size - mic_width) // 2
mic_y = 8

# 绘制麦克风主体（圆角矩形）
draw.rounded_rectangle(
    [mic_x, mic_y, mic_x + mic_width, mic_y + mic_height],
    radius=10,
    fill=mic_color,
    outline=(50, 100, 150, 255),
    width=2
)

# 麦克风格栅线（3条横线）
grid_color = (200, 220, 240, 200)
for i in range(3):
    y = mic_y + 8 + i * 8
    draw.line(
        [mic_x + 4, y, mic_x + mic_width - 4, y],
        fill=grid_color,
        width=2
    )

# 麦克风支架（下方的弧形）
arc_y = mic_y + mic_height
arc_bottom = size - 12

# 绘制支架弧线
draw.arc(
    [mic_x - 6, arc_y - 4, mic_x + mic_width + 6, arc_bottom],
    start=180,
    end=360,
    fill=stand_color,
    width=3
)

# 绘制支架底座（竖线）
center_x = size // 2
draw.line(
    [center_x, arc_bottom - 10, center_x, size - 6],
    fill=stand_color,
    width=3
)

# 底座横线
base_width = 18
draw.line(
    [center_x - base_width//2, size - 6, center_x + base_width//2, size - 6],
    fill=stand_color,
    width=4
)

# 保存图标
img.save('assets/tray-icon.png', 'PNG')
print('Tray icon created: assets/tray-icon.png')

# 也创建一个 ICO 文件用于 Windows 应用图标
img_ico = img.resize((256, 256), Image.Resampling.LANCZOS)
img_ico.save('assets/app-icon.ico', format='ICO', sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
print('App icon created: assets/app-icon.ico')
