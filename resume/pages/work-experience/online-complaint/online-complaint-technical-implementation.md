# 在线投诉系统技术实现

## 1. 项目结构

### 1.1 目录结构

```
online-complaint/
├── src/
│   ├── main/
│   │   ├── java/
│   │   │   └── com/
│   │   │       └── example/
│   │   │           └── complaint/
│   │   │               ├── controller/   # 控制器
│   │   │               ├── service/      # 服务层
│   │   │               ├── dao/          # 数据访问层
│   │   │               ├── model/        # 数据模型
│   │   │               ├── config/       # 配置
│   │   │               ├── util/         # 工具类
│   │   │               └── exception/    # 异常处理
│   │   ├── resources/
│   │   │   ├── mapper/      # MyBatis 映射文件
│   │   │   ├── config/       # 配置文件
│   │   │   └── static/       # 静态资源
│   │   └── webapp/
│   │       └── WEB-INF/
│   │           └── views/     # JSP 视图
│   └── test/                 # 测试代码
├── pom.xml                   # Maven 配置文件
└── README.md                 # 项目说明
```

### 1.2 核心模块

- **controller**：处理 HTTP 请求和响应
- **service**：实现核心业务逻辑
- **dao**：负责数据库操作
- **model**：定义数据模型
- **config**：管理系统配置
- **util**：提供工具方法
- **exception**：处理异常

## 2. 技术实现

### 2.1 核心配置

#### pom.xml

```xml
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    
    <groupId>com.example</groupId>
    <artifactId>online-complaint</artifactId>
    <version>1.0.0</version>
    <packaging>war</packaging>
    
    <dependencies>
        <!-- Spring MVC -->
        <dependency>
            <groupId>org.springframework</groupId>
            <artifactId>spring-webmvc</artifactId>
            <version>5.3.20</version>
        </dependency>
        
        <!-- MyBatis -->
        <dependency>
            <groupId>org.mybatis</groupId>
            <artifactId>mybatis</artifactId>
            <version>3.5.9</version>
        </dependency>
        
        <!-- MyBatis-Spring -->
        <dependency>
            <groupId>org.mybatis</groupId>
            <artifactId>mybatis-spring</artifactId>
            <version>2.0.7</version>
        </dependency>
        
        <!-- MySQL 驱动 -->
        <dependency>
            <groupId>mysql</groupId>
            <artifactId>mysql-connector-java</artifactId>
            <version>8.0.29</version>
        </dependency>
        
        <!-- Apache Commons -->
        <dependency>
            <groupId>commons-lang</groupId>
            <artifactId>commons-lang</artifactId>
            <version>2.6</version>
        </dependency>
        
        <!-- JSP -->
        <dependency>
            <groupId>javax.servlet</groupId>
            <artifactId>javax.servlet-api</artifactId>
            <version>4.0.1</version>
            <scope>provided</scope>
        </dependency>
        
        <!-- Bootstrap -->
        <dependency>
            <groupId>org.webjars</groupId>
            <artifactId>bootstrap</artifactId>
            <version>4.6.0</version>
        </dependency>
        
        <!-- jQuery -->
        <dependency>
            <groupId>org.webjars</groupId>
            <artifactId>jquery</artifactId>
            <version>3.6.0</version>
        </dependency>
    </dependencies>
    
    <build>
        <finalName>online-complaint</finalName>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-compiler-plugin</artifactId>
                <version>3.8.1</version>
                <configuration>
                    <source>1.8</source>
                    <target>1.8</target>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>
```

#### Spring 配置

```xml
<!-- spring-mvc.xml -->
<beans xmlns="http://www.springframework.org/schema/beans"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       xmlns:context="http://www.springframework.org/schema/context"
       xmlns:mvc="http://www.springframework.org/schema/mvc"
       xsi:schemaLocation="http://www.springframework.org/schema/beans
                           http://www.springframework.org/schema/beans/spring-beans.xsd
                           http://www.springframework.org/schema/context
                           http://www.springframework.org/schema/context/spring-context.xsd
                           http://www.springframework.org/schema/mvc
                           http://www.springframework.org/schema/mvc/spring-mvc.xsd">
    
    <!-- 扫描控制器 -->
    <context:component-scan base-package="com.example.complaint.controller"/>
    
    <!-- 启用 MVC 注解 -->
    <mvc:annotation-driven/>
    
    <!-- 静态资源映射 -->
    <mvc:resources mapping="/static/**" location="/static/"/>
    
    <!-- 视图解析器 -->
    <bean class="org.springframework.web.servlet.view.InternalResourceViewResolver">
        <property name="prefix" value="/WEB-INF/views/"/>
        <property name="suffix" value=".jsp"/>
    </bean>
</beans>
```

### 2.2 数据模型

#### 投诉模型

```java
public class Complaint {
    private Integer id;
    private String complainant;
    private String contact;
    private String content;
    private String status;
    private String handler;
    private Date createTime;
    private Date handleTime;
    private String result;
    
    // getter and setter
}
```

#### 页面配置模型

```java
public class PageConfig {
    private Integer id;
    private String pageName;
    private String pageLayout;
    private String fields;
    private String validationRules;
    private Date createTime;
    private Date updateTime;
    
    // getter and setter
}
```

#### 用户模型

```java
public class User {
    private Integer id;
    private String username;
    private String password;
    private String role;
    private String status;
    private Date createTime;
    
    // getter and setter
}
```

### 2.3 数据访问层

#### 投诉 DAO

```java
@Mapper
public interface ComplaintDao {
    List<Complaint> findAll();
    List<Complaint> findByCondition(Complaint condition);
    Complaint findById(Integer id);
    int insert(Complaint complaint);
    int update(Complaint complaint);
    int delete(Integer id);
}
```

#### 页面配置 DAO

```java
@Mapper
public interface PageConfigDao {
    List<PageConfig> findAll();
    PageConfig findByName(String pageName);
    int insert(PageConfig pageConfig);
    int update(PageConfig pageConfig);
    int delete(Integer id);
}
```

#### 用户 DAO

```java
@Mapper
public interface UserDao {
    List<User> findAll();
    User findByUsername(String username);
    int insert(User user);
    int update(User user);
    int delete(Integer id);
}
```

### 2.4 服务层

#### 投诉服务

```java
@Service
public class ComplaintService {
    @Autowired
    private ComplaintDao complaintDao;
    
    public List<Complaint> findAll() {
        return complaintDao.findAll();
    }
    
    public List<Complaint> findByCondition(Complaint condition) {
        return complaintDao.findByCondition(condition);
    }
    
    public Complaint findById(Integer id) {
        return complaintDao.findById(id);
    }
    
    public int insert(Complaint complaint) {
        complaint.setCreateTime(new Date());
        complaint.setStatus("待处理");
        return complaintDao.insert(complaint);
    }
    
    public int update(Complaint complaint) {
        if ("已处理".equals(complaint.getStatus())) {
            complaint.setHandleTime(new Date());
        }
        return complaintDao.update(complaint);
    }
    
    public int delete(Integer id) {
        return complaintDao.delete(id);
    }
}
```

#### 页面配置服务

```java
@Service
public class PageConfigService {
    @Autowired
    private PageConfigDao pageConfigDao;
    
    public List<PageConfig> findAll() {
        return pageConfigDao.findAll();
    }
    
    public PageConfig findByName(String pageName) {
        return pageConfigDao.findByName(pageName);
    }
    
    public int insert(PageConfig pageConfig) {
        pageConfig.setCreateTime(new Date());
        pageConfig.setUpdateTime(new Date());
        return pageConfigDao.insert(pageConfig);
    }
    
    public int update(PageConfig pageConfig) {
        pageConfig.setUpdateTime(new Date());
        return pageConfigDao.update(pageConfig);
    }
    
    public int delete(Integer id) {
        return pageConfigDao.delete(id);
    }
}
```

#### 用户服务

```java
@Service
public class UserService {
    @Autowired
    private UserDao userDao;
    
    public List<User> findAll() {
        return userDao.findAll();
    }
    
    public User findByUsername(String username) {
        return userDao.findByUsername(username);
    }
    
    public int insert(User user) {
        user.setCreateTime(new Date());
        user.setStatus("启用");
        return userDao.insert(user);
    }
    
    public int update(User user) {
        return userDao.update(user);
    }
    
    public int delete(Integer id) {
        return userDao.delete(id);
    }
}
```

### 2.5 控制器

#### 投诉控制器

```java
@Controller
@RequestMapping("/complaint")
public class ComplaintController {
    @Autowired
    private ComplaintService complaintService;
    
    @GetMapping("/list")
    public String list(Model model, Complaint condition) {
        List<Complaint> complaints = complaintService.findByCondition(condition);
        model.addAttribute("complaints", complaints);
        model.addAttribute("condition", condition);
        return "complaint/list";
    }
    
    @GetMapping("/add")
    public String add() {
        return "complaint/add";
    }
    
    @PostMapping("/add")
    public String add(Complaint complaint) {
        complaintService.insert(complaint);
        return "redirect:/complaint/list";
    }
    
    @GetMapping("/edit/{id}")
    public String edit(@PathVariable Integer id, Model model) {
        Complaint complaint = complaintService.findById(id);
        model.addAttribute("complaint", complaint);
        return "complaint/edit";
    }
    
    @PostMapping("/edit")
    public String edit(Complaint complaint) {
        complaintService.update(complaint);
        return "redirect:/complaint/list";
    }
    
    @GetMapping("/delete/{id}")
    public String delete(@PathVariable Integer id) {
        complaintService.delete(id);
        return "redirect:/complaint/list";
    }
}
```

#### 页面配置控制器

```java
@Controller
@RequestMapping("/pageConfig")
public class PageConfigController {
    @Autowired
    private PageConfigService pageConfigService;
    
    @GetMapping("/list")
    public String list(Model model) {
        List<PageConfig> pageConfigs = pageConfigService.findAll();
        model.addAttribute("pageConfigs", pageConfigs);
        return "pageConfig/list";
    }
    
    @GetMapping("/add")
    public String add() {
        return "pageConfig/add";
    }
    
    @PostMapping("/add")
    public String add(PageConfig pageConfig) {
        pageConfigService.insert(pageConfig);
        return "redirect:/pageConfig/list";
    }
    
    @GetMapping("/edit/{id}")
    public String edit(@PathVariable Integer id, Model model) {
        PageConfig pageConfig = pageConfigService.findById(id);
        model.addAttribute("pageConfig", pageConfig);
        return "pageConfig/edit";
    }
    
    @PostMapping("/edit")
    public String edit(PageConfig pageConfig) {
        pageConfigService.update(pageConfig);
        return "redirect:/pageConfig/list";
    }
    
    @GetMapping("/delete/{id}")
    public String delete(@PathVariable Integer id) {
        pageConfigService.delete(id);
        return "redirect:/pageConfig/list";
    }
}
```

#### 用户控制器

```java
@Controller
@RequestMapping("/user")
public class UserController {
    @Autowired
    private UserService userService;
    
    @GetMapping("/list")
    public String list(Model model) {
        List<User> users = userService.findAll();
        model.addAttribute("users", users);
        return "user/list";
    }
    
    @GetMapping("/add")
    public String add() {
        return "user/add";
    }
    
    @PostMapping("/add")
    public String add(User user) {
        userService.insert(user);
        return "redirect:/user/list";
    }
    
    @GetMapping("/edit/{id}")
    public String edit(@PathVariable Integer id, Model model) {
        User user = userService.findById(id);
        model.addAttribute("user", user);
        return "user/edit";
    }
    
    @PostMapping("/edit")
    public String edit(User user) {
        userService.update(user);
        return "redirect:/user/list";
    }
    
    @GetMapping("/delete/{id}")
    public String delete(@PathVariable Integer id) {
        userService.delete(id);
        return "redirect:/user/list";
    }
}
```

## 3. 数据库设计

### 3.1 投诉表

```sql
CREATE TABLE `complaint` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `complainant` VARCHAR(255) NOT NULL,
  `contact` VARCHAR(255) NOT NULL,
  `content` TEXT NOT NULL,
  `status` VARCHAR(20) NOT NULL,
  `handler` VARCHAR(255),
  `create_time` DATETIME NOT NULL,
  `handle_time` DATETIME,
  `result` TEXT,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
```

### 3.2 页面配置表

```sql
CREATE TABLE `page_config` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `page_name` VARCHAR(255) NOT NULL,
  `page_layout` TEXT NOT NULL,
  `fields` TEXT NOT NULL,
  `validation_rules` TEXT,
  `create_time` DATETIME NOT NULL,
  `update_time` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `page_name` (`page_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
```

### 3.3 用户表

```sql
CREATE TABLE `user` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(50) NOT NULL,
  `password` VARCHAR(255) NOT NULL,
  `role` VARCHAR(20) NOT NULL,
  `status` VARCHAR(20) NOT NULL,
  `create_time` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
```

## 4. 可视化配置实现

### 4.1 配置存储

所有页面配置都存储在 `page_config` 表中，包括：

- **page_name**：页面名称
- **page_layout**：页面布局，使用 JSON 格式存储
- **fields**：页面字段，使用 JSON 格式存储
- **validation_rules**：验证规则，使用 JSON 格式存储

### 4.2 配置解析

在控制器中，通过 `PageConfigService` 获取页面配置，然后解析配置信息，动态生成页面。

```java
@GetMapping("/dynamic/{pageName}")
public String dynamic(@PathVariable String pageName, Model model) {
    PageConfig pageConfig = pageConfigService.findByName(pageName);
    if (pageConfig == null) {
        return "error";
    }
    
    // 解析页面布局
    JSONObject layoutJson = new JSONObject(pageConfig.getPageLayout());
    model.addAttribute("layout", layoutJson);
    
    // 解析页面字段
    JSONArray fieldsJson = new JSONArray(pageConfig.getFields());
    model.addAttribute("fields", fieldsJson);
    
    // 解析验证规则
    if (pageConfig.getValidationRules() != null) {
        JSONObject validationJson = new JSONObject(pageConfig.getValidationRules());
        model.addAttribute("validation", validationJson);
    }
    
    return "dynamic/page";
}
```

### 4.3 动态页面生成

在 JSP 页面中，使用 JSTL 和 EL 表达式动态生成页面内容。

```jsp
<%@ page language="java" contentType="text/html; charset=UTF-8" pageEncoding="UTF-8" %>
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${layout.title}</title>
    <link rel="stylesheet" href="/static/webjars/bootstrap/4.6.0/css/bootstrap.min.css">
    <script src="/static/webjars/jquery/3.6.0/jquery.min.js"></script>
    <script src="/static/webjars/bootstrap/4.6.0/js/bootstrap.min.js"></script>
</head>
<body>
    <div class="container">
        <h1>${layout.title}</h1>
        <form action="${layout.action}" method="${layout.method}">
            <c:forEach items="${fields}" var="field">
                <div class="form-group">
                    <label for="${field.id}">${field.label}</label>
                    <input type="${field.type}" class="form-control" id="${field.id}" name="${field.name}" placeholder="${field.placeholder}">
                </div>
            </c:forEach>
            <button type="submit" class="btn btn-primary">${layout.submitText}</button>
        </form>
    </div>
</body>
</html>
```

## 5. 总结

在线投诉系统采用 Spring MVC 和 Maven 构建，通过可视化配置方式，所有页面配置都存储在数据库中，无需代码开发即可快速满足客户需求。系统实现了投诉管理、配置管理和用户管理等核心功能，具有良好的可扩展性和维护性。

通过本技术实现文档，开发者可以了解系统的技术架构、核心模块和实现方式，为系统的开发和维护提供参考。