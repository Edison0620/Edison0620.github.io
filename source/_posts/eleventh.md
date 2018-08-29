---
title: iOS开发里的那些散手（一）
tags:
  - EXP
  - iOS
  - OC
categories: 笔记
abbrlink: 2949cf0a
date: 2017-07-28 19:37:05
---


## 解决低版本Xcode不支持高版本iOS真机调试问题

在真机运行程序后输出如下错误

```objectivec
The version of iOS on “xxx xxx” does not match any of the versions of iOS supported for development with this installation of the iOS SDK. Please restore the device to a version of the iOS listed below, or update to the latest version of the iOS.
```
主要原因是在调试前我将iOS SDK升级到了9.3版本，而我的Xcode是7.3版本的，只支持到9.2的SDK。
其实每次iOS SDK版本升级都会遇到相同的问题，之前有在网上找过，除了重新安装Xcode外就是下载新的Xcode将里面的SDK复制到旧的Xcode中。
由于之前我是黑苹果，不能升级系统以更新`Xcode`到最新版，所以只能谷歌一下自己DIY了。

解决方法：
这里只以我的开发环境为参照，具体修改还要参照个人开发环境，基本步骤有三步

1、复制一份旧的`SDK`，并重新命名为真机测试需要的`SDK`版本；
找到路径:`/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS9.2.sdk`（提示：`Xcode7.3`的`iOS SDK`信息会保存在xcode.app中，要查找请右键点击xcode.app－>显示包内容，其他xcode版本的iOS SDK有的保存在系统根目录下）
复制一份`iPhoneOS9.2.sdk`，并命名为`iPhoneOS9.3.sdk`

2、修改
打开路径:`/Developer/Platforms/iPhoneOS.platform/DeviceSupport`找到：9.2(10A403) (这个是我的xcode中`SDK`的最高版本，如果没有这个也可以选择其他的)复制一份，并创新命名为真机需要的版本9.3(10B114)

3、修改SDKSettings.plist文件中的版本号
打开路径:`9.3(10B114)/Symbols/SDKSettings.plist`
将里面所有跟版本有关的数字都修改为9.3

4、真机运行，成功。

## 调试用 宏定义NSLog

在类文件头部添加
```objectivec
#define NSLog(...) printf("%f %s\n",[[NSDate date]timeIntervalSince1970],[[NSString stringWithFormat:__VA_ARGS__]UTF8String]);
```

## 定义UIButton某个角圆角

```objectivec
UIBezierPath *maskPath = [UIBezierPath bezierPathWithRoundedRect:btn.bounds      byRoundingCorners:UIRectCornerTopLeft | UIRectCornerTopRight    cornerRadii:CGSizeMake(10, 10)];
        CAShapeLayer *maskLayer = [[CAShapeLayer alloc] init];
        maskLayer.frame = btn.bounds;
        maskLayer.path = maskPath.CGPath;
        btn.layer.mask = maskLayer;
```

## 设置导航栏透明

```objectivec
[[[self.navigationController.navigationBar subviews] objectAtIndex:0] setAlpha:0];
```
## 设置Button图片文字垂直

首先需要设置`UIButton`的`Image`（注意，不是`BackgroundImage`）和`Title`，然后再引用这个方法

```objectivec
-(void)setButtonContentCenter:(UIButton *) btn

{

    CGSize imgViewSize,titleSize,btnSize;

    UIEdgeInsets imageViewEdge,titleEdge;

    CGFloat heightSpace = 10.0f;

   

    //设置按钮内边距

    imgViewSize = btn.imageView.bounds.size;

    titleSize = btn.titleLabel.bounds.size;

    btnSize = btn.bounds.size;

   

    imageViewEdge = UIEdgeInsetsMake(heightSpace,0.0, btnSize.height -imgViewSize.height - heightSpace, - titleSize.width);

    [btn setImageEdgeInsets:imageViewEdge];

    titleEdge = UIEdgeInsetsMake(imgViewSize.height +heightSpace, - imgViewSize.width, 0.0, 0.0);

    [btn setTitleEdgeInsets:titleEdge];

}
```

## 判断软件是不是第一次启动

原理是用`NSUserDefaults`在本地产生一个值，第二次启动的时候判断是否存在，存在即不是第一次打开，反之就是第一次打开。

```objectivec
 self.window = [[UIWindow alloc]initWithFrame:[[UIScreen mainScreen]bounds]];
    
    if (![[NSUserDefaults standardUserDefaults]boolForKey:@"firstLaunch"]) {
        [[NSUserDefaults standardUserDefaults]setBool:YES forKey:@"firstLaunch"];
        NSLog(@"第一次启动");
        UserGuideViewController *UGC =[[UserGuideViewController alloc]init];
        UINavigationController *NC = [[UINavigationController alloc]initWithRootViewController:UGC];
        self.window.rootViewController = NC;
    }
    else{
        NSLog(@"这不是第一次启动");
        ViewController *VC = [[ViewController alloc]init];
        UINavigationController *NC = [[UINavigationController alloc]initWithRootViewController:VC];
        self.window.rootViewController = NC;
		}
```


