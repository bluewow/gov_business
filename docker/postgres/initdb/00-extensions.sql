-- 컨테이너 최초 기동 시 1회 실행 (볼륨이 비어 있을 때만).
-- 스키마/테이블은 prisma migrate 가 관리하므로 여기서는 확장만 설치한다.

-- 애플리케이션 DB
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm; -- 공고 제목 부분일치 검색용

-- template1 에도 설치해 두면 이후 CREATE DATABASE 로 만들어지는 DB 가 확장을 상속받는다.
-- prisma migrate dev 가 쓰는 shadow database 에 vector 타입이 없으면 마이그레이션이 실패하므로 필수.
\connect template1
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
