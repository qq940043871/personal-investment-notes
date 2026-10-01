# ArcGIS Java 开发环境搭建

## 1. 环境要求

### 1.1 系统要求

| 操作系统 | 版本要求 |
|----------|----------|
| Windows | Windows 10 或 Windows 11 |
| macOS | macOS 10.15 或更高版本 |
| Linux | Ubuntu 18.04 或更高版本 |

### 1.2 软件要求

- **JDK**：JDK 8 或 JDK 11
- **IDE**：IntelliJ IDEA 2020.1 或更高版本，或 Eclipse 2020-06 或更高版本
- **ArcGIS 开发包**：ArcGIS Runtime SDK for Java 100.14 或更高版本

## 2. JDK 安装

### 2.1 下载 JDK

1. 访问 [Oracle JDK 下载页面](https://www.oracle.com/java/technologies/downloads/) 或 [OpenJDK 下载页面](https://openjdk.java.net/)。
2. 下载适合您操作系统的 JDK 8 或 JDK 11 版本。

### 2.2 安装 JDK

1. 运行下载的安装程序。
2. 按照安装向导的提示完成安装。
3. 配置环境变量 `JAVA_HOME`，指向 JDK 安装目录。
4. 将 `%JAVA_HOME%\bin` 添加到 `PATH` 环境变量中。

### 2.3 验证 JDK 安装

打开命令提示符或终端，运行以下命令：

```bash
java -version
```

如果显示 JDK 版本信息，则说明 JDK 安装成功。

## 3. IDE 安装

### 3.1 安装 IntelliJ IDEA

1. 访问 [IntelliJ IDEA 下载页面](https://www.jetbrains.com/idea/download/)。
2. 下载 Community 版或 Ultimate 版。
3. 运行安装程序，按照安装向导的提示完成安装。

### 3.2 安装 Eclipse

1. 访问 [Eclipse 下载页面](https://www.eclipse.org/downloads/)。
2. 下载 Eclipse IDE for Java Developers。
3. 解压下载的压缩包到合适的目录。

## 4. ArcGIS Runtime SDK for Java 安装

### 4.1 下载 ArcGIS Runtime SDK for Java

1. 访问 [ArcGIS for Developers](https://developers.arcgis.com/java/)。
2. 登录或注册 Esri 账户。
3. 下载 ArcGIS Runtime SDK for Java。

### 4.2 安装 ArcGIS Runtime SDK for Java

1. 运行下载的安装程序。
2. 按照安装向导的提示完成安装。
3. 记住安装目录，后续配置项目时需要使用。

## 5. 项目配置

### 5.1 IntelliJ IDEA 项目配置

1. 打开 IntelliJ IDEA，创建一个新的 Java 项目。
2. 在项目结构中，添加 ArcGIS Runtime SDK for Java 的依赖：
   - 选择 `File` > `Project Structure` > `Libraries`。
   - 点击 `+` 按钮，选择 `Java`。
   - 浏览到 ArcGIS Runtime SDK for Java 的安装目录，选择 `lib` 文件夹。
   - 点击 `OK` 完成添加。
3. 在模块设置中，确保 ArcGIS Runtime SDK for Java 库被添加到模块依赖中。

### 5.2 Eclipse 项目配置

1. 打开 Eclipse，创建一个新的 Java 项目。
2. 在项目属性中，添加 ArcGIS Runtime SDK for Java 的依赖：
   - 选择 `Project` > `Properties` > `Java Build Path` > `Libraries`。
   - 点击 `Add External JARs...` 按钮。
   - 浏览到 ArcGIS Runtime SDK for Java 的安装目录，选择 `lib` 文件夹中的所有 JAR 文件。
   - 点击 `OK` 完成添加。

## 6. 验证环境搭建

### 6.1 创建测试项目

1. 创建一个新的 Java 类，命名为 `HelloArcGIS`。
2. 编写以下代码：

```java
import com.esri.arcgisruntime.ArcGISRuntimeEnvironment;
import com.esri.arcgisruntime.mapping.ArcGISMap;
import com.esri.arcgisruntime.mapping.BasemapStyle;
import com.esri.arcgisruntime.mapping.view.MapView;
import javafx.application.Application;
import javafx.scene.Scene;
import javafx.scene.layout.StackPane;
import javafx.stage.Stage;

public class HelloArcGIS extends Application {
    private MapView mapView;

    @Override
    public void start(Stage stage) {
        // 设置 ArcGIS Runtime 许可
        ArcGISRuntimeEnvironment.setLicense("your-license-key");

        // 创建地图视图
        mapView = new MapView();

        // 创建地图，使用默认底图
        ArcGISMap map = new ArcGISMap(BasemapStyle.ARCGIS_STREETS);
        mapView.setMap(map);

        // 创建场景
        StackPane stackPane = new StackPane();
        stackPane.getChildren().add(mapView);
        Scene scene = new Scene(stackPane, 800, 600);

        // 设置舞台
        stage.setTitle("Hello ArcGIS");
        stage.setScene(scene);
        stage.show();
    }

    @Override
    public void stop() {
        // 释放资源
        if (mapView != null) {
            mapView.dispose();
        }
    }

    public static void main(String[] args) {
        launch(args);
    }
}
```

### 6.2 运行测试项目

1. 运行 `HelloArcGIS` 类。
2. 如果能看到一个显示地图的窗口，则说明环境搭建成功。

## 7. 常见问题及解决方案

### 7.1 找不到 ArcGIS 类

**问题**：编译时出现 `找不到符号` 错误，提示找不到 ArcGIS 相关的类。

**解决方案**：
- 检查 ArcGIS Runtime SDK for Java 的依赖是否正确添加。
- 检查 IDE 的项目配置是否正确。

### 7.2 运行时缺少库文件

**问题**：运行时出现 `UnsatisfiedLinkError` 错误，提示缺少本地库文件。

**解决方案**：
- 确保 ArcGIS Runtime SDK for Java 的 native 库路径被正确添加到系统路径中。
- 在 IntelliJ IDEA 中，可以在运行配置中添加 `-Djava.library.path` 参数，指向 ArcGIS Runtime SDK for Java 的 native 库目录。

### 7.3 许可问题

**问题**：运行时出现许可错误，提示未授权或许可过期。

**解决方案**：
- 确保使用了有效的 ArcGIS Runtime 许可。
- 对于开发和测试，可以使用 ArcGIS Runtime 的开发者许可。

## 8. 总结

搭建 ArcGIS Java 开发环境需要安装 JDK、IDE 和 ArcGIS Runtime SDK for Java，并正确配置项目依赖。通过本指南的步骤，您应该能够成功搭建 ArcGIS Java 开发环境，并开始开发 ArcGIS Java 应用程序。