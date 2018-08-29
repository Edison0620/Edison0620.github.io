---
title: Android 笔记 - 调用系统发短信功能，自定义号码和短信内容
tags:
  - EXP
  - Android
categories: 笔记
abbrlink: 7df5e206
date: 2017-07-07 20:31:05
---

&#160; &#160; &#160; &#160;开发需用使用到系统短信功能，昨天看了下文档，弄了一下午，现在已经得到我想要的效果，做个笔记记一下。具体有两种方法，一种需要跳到系统短信界面发送，可自带号码和短信内容参数，另一种可以直接在App内发送，并返回发送状态。两种方法都写在下面。

&#160; &#160; &#160; &#160;*无论是哪种方法，都需要申请权限，在app/src/main/AndroidManifest.xml文件内添加*
```java
	<uses-permission android:name="android.permission.SEND_SMS" />
```
## 跳到系统界面发送短信

### 新建工具类
　　为了方便使用，我们定义一个工具类用来调用。

```java
public class ContentUtil {
 
	    public static void showToast(Context context, String msg)
	    {
	        Toast.makeText(context, msg, Toast.LENGTH_SHORT).show();;
	    }
	
	    /**
	     * 调用系统界面，给指定的号码发送短信，并附带短信内容
	     *
	     * @param context
	     * @param number
	     * @param body
	     */
	    public static void sendSmsWithBody(Context context, String number, String body) {
	        Intent sendIntent = new Intent(Intent.ACTION_SENDTO);
	        sendIntent.setData(Uri.parse("smsto:" + number));
	        sendIntent.putExtra("sms_body", body);
	        context.startActivity(sendIntent);
	    }
	}
```

### xml 布局文件修改
　　这里我放了两个文本输入框，和一个发送按钮。

```java
\<RelativeLayout xmlns:android="http://schemas.android.com/apk/res/android"
	    xmlns:tools="http://schemas.android.com/tools"
	    android:layout_width="match_parent"
	    android:layout_height="match_parent"
	    android:paddingBottom="@dimen/activity_vertical_margin"
	    android:paddingLeft="@dimen/activity_horizontal_margin"
	    android:paddingRight="@dimen/activity_horizontal_margin"
	    android:paddingTop="@dimen/activity_vertical_margin"
	    tools:context=".MessageActivity">
	
	    <EditText
	        android:id="@+id/phonenumber_edit"
	        android:layout_width="match_parent"
	        android:layout_height="wrap_content"
	        android:text="13879327137"/>
	
	    <EditText
	        android:id="@+id/message_edit"
	        android:layout_width="match_parent"
	        android:layout_height="wrap_content"
	        android:layout_below="@id/phonenumber_edit"
	        android:text="你好吗？"/>
	
	    <Button
	        android:id="@+id/message_btn"
	        android:layout_width="wrap_content"
	        android:layout_height="wrap_content"
	        android:layout_below="@+id/message_edit"
	        android:text="发送"/>
	</RelativeLayout>
```

### Activity 活动文件修改
方法实现

```java
	public class MessageActivity extends Activity {
	
	    private EditText phoneNumedit;
	    private EditText msgEdit;
	    private Button msgBtn;
	
	@Override
	    protected void onCreate(Bundle savedInstanceState) {
	        super.onCreate(savedInstanceState);
	        setContentView(R.layout.activity_message);
	
	        phoneNumedit=(EditText) findViewById(R.id.phonenumber_edit);
	        msgEdit=(EditText) findViewById(R.id.message_edit);
	        msgBtn=(Button)findViewById(R.id.message_btn);
	        msgBtn.setOnClickListener(new View.OnClickListener() {
	            @Override
	            public void onClick(View v) {
	                if (msgEdit.getText().toString() != "" && phoneNumedit.getText().toString() != "") //判断手机号和短信内容不为空
	                {
	                    ContentUtil.sendSmsWithBody(MessageActivity.this, phoneNumedit.getText().toString() , msgEdit.getText().toString());
	                }
	            }
	        });
	  }
	}
```

　　点击运行就可以看到效果了。

## 后台静默发短信
　　布局文件和上面的差不多，就是名字不一样。所以省略一下，下面是方法实现
### Activity 活动文件修改

```java
	public class Message_second extends AppCompatActivity {
	
	    private EditText phone_number_editText;
	    private EditText sms_content_editText;
	    private Button send_sms_button;
	
	    @Override
	    protected void onCreate(Bundle savedInstanceState) {
	        super.onCreate(savedInstanceState);
	        setContentView(R.layout.activity_message_second);
	
	        phone_number_editText = (EditText) findViewById(R.id.phone_number_editText);
	        sms_content_editText = (EditText) findViewById(R.id.sms_content_editText);
	        send_sms_button = (Button) findViewById(R.id.send_sms_button);
	
	        send_sms_button.setOnClickListener(new View.OnClickListener() {
	
	            @Override
	            public void onClick(View arg0) {
	                String phone_number = phone_number_editText.getText().toString().trim();
	                String sms_content = sms_content_editText.getText().toString().trim();
	                if(phone_number.equals("")) {
	                    Toast.makeText(Message_second.this, R.string.str_remind_input_phone_number, Toast.LENGTH_LONG).show();
	                } else {
	                    SmsManager smsManager = SmsManager.getDefault();
	                    if(sms_content.length() > 70) {
	                        List<String> contents = smsManager.divideMessage(sms_content);
	                        for(String sms : contents) {
	                            smsManager.sendTextMessage(phone_number, null, sms, null, null);
	                        }
	                    } else {
	                        smsManager.sendTextMessage(phone_number, null, sms_content, null, null);
	                    }
	                    Toast.makeText(Message_second.this, R.string.str_remind_sms_send_finish, Toast.LENGTH_SHORT).show();
	                }
	            }
	        });
	    }
	}
```

## OVER
　　托谷歌的福，以上就是我半天的工作成果。其他时间需要做对短信内容进行AES加密，不过我还不怎么懂。稍微了解了一下发现很有意思的一点，寻常意义上的加密，是用通信双方约定好的密匙，然后对要传达的信息进行加密。但原来现在有很多加密方法，是把要送达的信息当做密匙用，而加密内容反而要双方约定好。从送信的动作传达信息，而不是通过信本身，这点我觉得很有意思。聪明人可真多啊\~
