// 테스트는 사용자 이력서에 의존하지 않는다. 자료를 추가해도 검증 조건이 바뀌지 않는다.
export const knowledge = {version:'test-version', chunks:[
  {id:'intro',documentId:'a',source:'소개.md',location:'소개',text:'Raon은 Java와 Spring으로 서버를 개발하는 백엔드 개발자입니다.'},
  {id:'skills',documentId:'a',source:'소개.md',location:'기술',text:'주요 기술 스택: Java, Spring Boot, MySQL, Docker, Linux.'},
  {id:'devops',documentId:'a',source:'소개.md',location:'관심',text:'DevOps에 관심이 있으며 개발과 운영을 연결하기 위해 CI/CD, Kubernetes와 클라우드 자동화를 학습합니다.'},
  {id:'goal',documentId:'a',source:'소개.md',location:'목표',text:'장기적인 목표는 시니어 개발자로 성장하고 DevOps 전문성을 갖추는 것입니다.'},
]};
