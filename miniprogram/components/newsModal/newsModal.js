// components/newsModal/newsModal.js
Component({
    options: {
      multipleSlots: true
    },
    properties: {
      title: {
        type: String,
        value: '公告标题'
      },
      content :{
        type : String ,
        value : '公告内容'
      },
      cancelText :{
        type : String ,
        value : '关闭'
      },
      confirmText :{
        type : String ,
        value : '查看详情'
      },
      imagePath :{
        type : String ,
        value : ''
      },
      time :{
        type : String ,
        value : ''
      },
      newsClass :{
        type : String ,
        value : ''
      },
      user :{
        type : String ,
        value : ''
      },
    },

    data: {
      isShow: false,
      muteWeek: false
    },

    methods: {
      hideNewsModal(){
        this.setData({
          isShow: false,
          muteWeek: false
        })
      },
      showNewsModal(){
        this.setData({
          isShow: true,
          muteWeek: false
        })
      },
      _toggleMute() {
        this.setData({
          muteWeek: !this.data.muteWeek
        })
      },
      _cancelEvent(){
        const muteWeek = this.data.muteWeek;
        this.hideNewsModal();
        this.triggerEvent("cancelEvent", { muteWeek: muteWeek })
      },
      _confirmEvent(){
        const muteWeek = this.data.muteWeek;
        this.hideNewsModal();
        this.triggerEvent("confirmEvent", { muteWeek: muteWeek })
      }
    }
  })
